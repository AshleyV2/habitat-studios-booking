import { randomInt } from 'node:crypto';
import type {
  adminBookingSchema,
  adminBookingUpdateSchema,
  cancelBookingSchema,
  CreatedOnlineBooking,
  PriceLine,
  PublicBookingView,
  publicBookingSchema,
  Quote,
  slotSchema,
} from '@habitat/shared';
import { Prisma, type Booking, type PromoCode, type Settings } from '@prisma/client';
import type { z } from 'zod';
import { env } from '../config/env';
import { prisma, type Tx } from '../db/prisma';
import { stripe } from '../stripe/client';
import { AppError, badRequest, conflict, notFound, serviceUnavailable } from '../utils/errors';
import { logger } from '../utils/logger';
import { manageToken, newManageSalt, verifyManageToken } from '../utils/manage-token';
import { localTimeLabel, toLocal } from '../utils/time';
import { audit } from './audit.service';
import {
  assertAvailable,
  assertBookingRules,
  expireStaleHolds,
  lockBookings,
  resolveSlot,
  type ResolvedSlot,
} from './availability.service';
import { enqueueEmail, flushOutboxSoon } from './email/outbox';
import {
  adminCancellationEmail,
  adminNewBookingEmail,
  bookingChangedEmail,
  cancellationEmail,
  confirmationEmail,
  paymentLinkEmail,
} from './email/templates';
import { createCheckout, paidPence, recordManualPayment, refundPayment } from './payment.service';
import { priceBooking, resolveRatePlan, type PricedBooking } from './pricing.service';
import { checkPromo } from './promo.service';
import { getOpeningHours, getSettings } from './settings.service';
import { integrations } from '../config/integrations';

const REF_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const TX_OPTS = { timeout: 20_000, maxWait: 10_000 } as const;

async function newReference(tx: Tx) {
  for (let i = 0; i < 10; i++) {
    const ref = `${integrations().bookingRefPrefix}-${Array.from({ length: 6 }, () => REF_ALPHABET[randomInt(REF_ALPHABET.length)]).join('')}`;
    if (!(await tx.booking.findUnique({ where: { reference: ref }, select: { id: true } }))) return ref;
  }
  throw new Error('Could not allocate a booking reference');
}

/** The exclusion constraint is the final guard; translate its violation into a clean 409. */
function isOverlapViolation(err: unknown) {
  const msg = err instanceof Error ? err.message : '';
  return msg.includes('booking_no_room_overlap') || msg.includes('23P01');
}

async function withBookingTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  try {
    return await prisma.$transaction(async (tx) => {
      await lockBookings(tx);
      await expireStaleHolds(tx);
      return fn(tx);
    }, TX_OPTS);
  } catch (err) {
    if (isOverlapViolation(err)) throw new AppError(409, 'slot_unavailable', 'That time has just been booked. Please choose another time.');
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Quotes
// ---------------------------------------------------------------------------

/** The room and the session type it is being booked on (null = hourly pricing). */
export async function roomAndPlan(tx: Tx, roomId: string, ratePlanId: string | null | undefined, opts: { requireActiveRoom: boolean }) {
  const room = await tx.room.findUnique({ where: { id: roomId }, include: { priceRules: true } });
  if (!room || (opts.requireActiveRoom && !room.active)) throw notFound('Room not found.');
  return { room, plan: resolveRatePlan(room, ratePlanId) };
}

function priceSlot(
  settings: Settings,
  rp: Awaited<ReturnType<typeof roomAndPlan>>,
  slot: ResolvedSlot,
  equipment: { item: Prisma.EquipmentGetPayload<object>; quantity: number }[],
  promo: PromoCode | null = null,
) {
  return priceBooking({ room: rp.room, ratePlan: rp.plan, startsAt: slot.startsAt, endsAt: slot.endsAt, equipment, timezone: settings.timezone, currency: settings.currency, promo });
}

/**
 * Price a slot with the customer's promo code, if they gave one. The code is checked against
 * this exact booking; when booking, an unusable code stops the booking (400), when quoting the
 * price is shown without it and the reason comes back as promoError.
 */
async function priceWithPromo(
  db: Tx | typeof prisma,
  settings: Settings,
  rp: Awaited<ReturnType<typeof roomAndPlan>>,
  slot: ResolvedSlot,
  equipment: { item: Prisma.EquipmentGetPayload<object>; quantity: number }[],
  code: string | null | undefined,
  opts: { customerEmail?: string; strict: boolean },
) {
  const base = priceSlot(settings, rp, slot, equipment);
  if (!code) return { priced: base, promo: null, promoError: null };
  try {
    const promo = await checkPromo(db, code, {
      roomId: rp.room.id,
      durationMinutes: slot.durationMinutes,
      subtotalPence: base.totalPence,
      currency: settings.currency,
      timezone: settings.timezone,
      customerEmail: opts.customerEmail,
    });
    return { priced: priceSlot(settings, rp, slot, equipment, promo), promo, promoError: null };
  } catch (err) {
    if (opts.strict || !(err instanceof AppError)) throw err;
    return { priced: base, promo: null, promoError: err.message };
  }
}

function toQuote(
  settings: Settings,
  rp: Awaited<ReturnType<typeof roomAndPlan>>,
  slot: ResolvedSlot,
  priced: PricedBooking,
  promo: { promo: PromoCode | null; promoError: string | null } = { promo: null, promoError: null },
): Quote {
  return {
    roomId: rp.room.id,
    roomName: rp.room.name,
    startsAt: slot.startsAt.toISOString(),
    endsAt: slot.endsAt.toISOString(),
    date: slot.date,
    startTime: localTimeLabel(slot.startsAt, settings.timezone),
    endTime: localTimeLabel(slot.endsAt, settings.timezone),
    durationMinutes: slot.durationMinutes,
    ratePlanId: rp.plan?.id ?? null,
    ratePlanName: rp.plan?.name ?? null,
    currency: settings.currency,
    lines: priced.lines,
    roomSubtotalPence: priced.roomSubtotalPence,
    equipmentSubtotalPence: priced.equipmentSubtotalPence,
    discountPence: priced.discountPence,
    totalPence: priced.totalPence,
    promo: promo.promo ? { code: promo.promo.code, description: promo.promo.description } : null,
    promoError: promo.promoError,
  };
}

/** Public quote: validates rules and live availability, returns the server-side price. */
export async function quote(input: z.output<typeof slotSchema>): Promise<Quote> {
  const [settings, hours] = await Promise.all([getSettings(), getOpeningHours()]);
  const slot = resolveSlot(settings, input.date, input.startTime, input.durationMinutes);
  const rp = await roomAndPlan(prisma, input.roomId, input.ratePlanId, { requireActiveRoom: true });
  assertBookingRules(settings, hours, slot, 'customer', new Date(), rp.plan, rp.room.minDurationMinutes);
  const equipment = await assertAvailable(prisma, { roomId: input.roomId, startsAt: slot.startsAt, endsAt: slot.endsAt, equipment: input.equipment });
  const p = await priceWithPromo(prisma, settings, rp, slot, equipment, input.promoCode, { strict: false });
  return toQuote(settings, rp, slot, p.priced, p);
}

// ---------------------------------------------------------------------------
// Online bookings
// ---------------------------------------------------------------------------

export function onlineBookingAvailability(settings: Settings): { available: boolean; reason: string | null } {
  if (!settings.onlineBookingEnabled) return { available: false, reason: 'Online booking is currently switched off. Please contact us to book.' };
  if (!integrations().stripe.enabled) return { available: false, reason: 'Online payment is not available at the moment. Please contact us to book.' };
  return { available: true, reason: null };
}

export async function createOnlineBooking(input: z.output<typeof publicBookingSchema>, ip: string | null): Promise<CreatedOnlineBooking> {
  const [settings, hours] = await Promise.all([getSettings(), getOpeningHours()]);
  const online = onlineBookingAvailability(settings);
  if (!online.available) throw serviceUnavailable(online.reason!);
  const slot = resolveSlot(settings, input.date, input.startTime, input.durationMinutes);
  const { room, plan } = await roomAndPlan(prisma, input.roomId, input.ratePlanId, { requireActiveRoom: true });
  assertBookingRules(settings, hours, slot, 'customer', new Date(), plan, room.minDurationMinutes);

  const booking = await withBookingTx(async (tx) => {
    const equipment = await assertAvailable(tx, { roomId: input.roomId, startsAt: slot.startsAt, endsAt: slot.endsAt, equipment: input.equipment });
    const rp = await roomAndPlan(tx, input.roomId, input.ratePlanId, { requireActiveRoom: true });
    // Checked inside the booking lock, so a code with one use left can't be used twice at once.
    const { priced, promo } = await priceWithPromo(tx, settings, rp, slot, equipment, input.promoCode, { customerEmail: input.customer.email, strict: true });
    const free = priced.totalPence === 0;
    if (!free && priced.totalPence < 50) throw badRequest('This booking cannot be paid online. Please contact us.');

    // Existing customer records are never overwritten by a public form; the booking keeps its own snapshot.
    const customer = await tx.customer.upsert({
      where: { email: input.customer.email },
      create: { name: input.customer.name, email: input.customer.email, phone: input.customer.phone, bandName: input.customer.bandName },
      update: {},
    });
    const created = await tx.booking.create({
      data: {
        reference: await newReference(tx),
        roomId: input.roomId,
        customerId: customer.id,
        // Nothing to pay (e.g. a 100% promo code): confirmed straight away.
        status: free ? 'CONFIRMED' : 'PENDING_PAYMENT',
        confirmedAt: free ? new Date() : null,
        source: 'ONLINE',
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        ratePlanId: rp.plan?.id ?? null,
        ratePlanName: rp.plan?.name ?? null,
        customerName: input.customer.name,
        customerEmail: input.customer.email,
        customerPhone: input.customer.phone,
        bandName: input.customer.bandName,
        customerNotes: input.notes,
        currency: settings.currency,
        roomSubtotalPence: priced.roomSubtotalPence,
        equipmentSubtotalPence: priced.equipmentSubtotalPence,
        discountPence: priced.discountPence,
        totalPence: priced.totalPence,
        pricingSnapshot: priced.snapshot as unknown as Prisma.InputJsonValue,
        promoCodeId: promo?.id ?? null,
        promoCode: promo?.code ?? null,
        expiresAt: free ? null : new Date(Date.now() + Math.max(30, settings.holdMinutes) * 60000),
        manageSalt: newManageSalt(),
        items: { create: priced.items },
      },
      include: { room: true },
    });
    await audit({ action: 'booking.created_online', targetType: 'booking', targetId: created.id, metadata: { reference: created.reference, totalPence: created.totalPence, ...(promo ? { promoCode: promo.code } : {}) }, ipAddress: ip }, tx);
    if (free) {
      await enqueueEmail(confirmationEmail(created, settings, 0), tx);
      if (settings.notifyOnNewBooking && settings.adminNotifyEmail) await enqueueEmail(adminNewBookingEmail(created, settings, settings.adminNotifyEmail), tx);
      await audit({ action: 'booking.confirmed', targetType: 'booking', targetId: created.id, metadata: { reference: created.reference, amountPence: 0, promoCode: promo?.code ?? null } }, tx);
    }
    return created;
  });

  if (booking.status === 'CONFIRMED') {
    flushOutboxSoon();
    return { reference: booking.reference, manageToken: manageToken(booking.id, booking.manageSalt), checkoutUrl: null };
  }

  // Stripe is called outside the transaction. If it fails, release the hold at once.
  try {
    const checkout = await createCheckout(booking, { amountPence: booking.totalPence, expiresAt: booking.expiresAt!, purpose: 'booking' });
    return { reference: booking.reference, manageToken: manageToken(booking.id, booking.manageSalt), checkoutUrl: checkout.url };
  } catch (err) {
    await prisma.booking.update({ where: { id: booking.id }, data: { status: 'EXPIRED', internalNotes: 'Payment could not be started (Stripe unavailable); hold released automatically.' } });
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Customer self-service (private link)
// ---------------------------------------------------------------------------

async function findForCustomer(reference: string, auth: { token?: string; sessionId?: string }) {
  const booking = await prisma.booking.findUnique({ where: { reference }, include: { room: true, payments: true } });
  const ok =
    booking &&
    ((auth.token && verifyManageToken(booking.id, booking.manageSalt, auth.token)) ||
      (auth.sessionId && booking.payments.some((p) => p.stripeCheckoutSessionId === auth.sessionId)));
  // Same response whether the reference or the token is wrong.
  if (!booking || !ok) throw notFound('Booking not found. Check the link in your email.');
  return booking;
}

function customerCancelDeadline(b: Booking, s: Settings) {
  return new Date(b.startsAt.getTime() - s.cancellationNoticeHours * 3600_000);
}

export async function getPublicBooking(reference: string, auth: { token?: string; sessionId?: string }): Promise<PublicBookingView> {
  const [b, s] = await Promise.all([findForCustomer(reference, auth), getSettings()]);
  const deadline = customerCancelDeadline(b, s);
  const canCancel =
    Boolean(auth.token) &&
    s.allowCustomerCancellation &&
    ((b.status === 'CONFIRMED' && new Date() < deadline) || b.status === 'PENDING_PAYMENT');
  return {
    reference: b.reference,
    status: b.status,
    roomName: b.room.name,
    date: toLocal(b.startsAt, s.timezone).date,
    startTime: localTimeLabel(b.startsAt, s.timezone),
    endTime: localTimeLabel(b.endsAt, s.timezone),
    startsAt: b.startsAt.toISOString(),
    endsAt: b.endsAt.toISOString(),
    customerName: b.customerName,
    customerEmail: b.customerEmail,
    lines: ((b.pricingSnapshot as { lines?: PriceLine[] })?.lines ?? []) as PriceLine[],
    totalPence: b.totalPence,
    paidPence: paidPence(b.payments),
    currency: b.currency,
    expiresAt: b.expiresAt?.toISOString() ?? null,
    cancellationReason: b.status === 'CANCELLED' ? b.cancellationReason : null,
    canCancel,
    cancelDeadline: b.status === 'CONFIRMED' ? deadline.toISOString() : null,
  };
}

export async function customerCancel(reference: string, token: string, ip: string | null) {
  const [b, s] = await Promise.all([findForCustomer(reference, { token }), getSettings()]);
  if (b.status === 'PENDING_PAYMENT') {
    // Abandoning checkout: release the slot and close the Stripe session.
    await prisma.booking.update({ where: { id: b.id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledBy: 'customer-abandoned', cancellationReason: 'Cancelled before payment' } });
    for (const p of b.payments.filter((p) => p.status === 'PENDING' && p.stripeCheckoutSessionId)) {
      await stripe().checkout.sessions.expire(p.stripeCheckoutSessionId!).catch((err) => logger.warn({ err }, 'Could not expire checkout session'));
    }
    await audit({ action: 'booking.abandoned', targetType: 'booking', targetId: b.id, metadata: { reference }, ipAddress: ip });
    return getPublicBooking(reference, { token });
  }
  if (!s.allowCustomerCancellation) throw new AppError(403, 'cancellation_disabled', 'Online cancellation is not available. Please contact us.');
  if (b.status !== 'CONFIRMED') throw conflict('This booking cannot be cancelled.');
  if (new Date() >= customerCancelDeadline(b, s)) {
    throw new AppError(409, 'too_late_to_cancel', `Bookings can be cancelled online up to ${s.cancellationNoticeHours} hours before they start. Please contact us.`);
  }
  await cancelBooking(b.id, { reason: 'Cancelled by customer online', refund: 'FULL', notifyCustomer: true }, { actorId: null, by: 'customer', ip });
  return getPublicBooking(reference, { token });
}

// ---------------------------------------------------------------------------
// Staff bookings
// ---------------------------------------------------------------------------

export async function createAdminBooking(input: z.output<typeof adminBookingSchema>, actorId: string, ip: string | null) {
  const [settings, hours] = await Promise.all([getSettings(), getOpeningHours()]);
  const slot = resolveSlot(settings, input.date, input.startTime, input.durationMinutes);
  if (input.durationMinutes % 15 !== 0 || slot.startMinute % 15 !== 0) throw badRequest('Times must be in 15-minute steps.');
  if (!input.ignoreBookingRules) assertBookingRules(settings, hours, slot, 'staff');

  const booking = await withBookingTx(async (tx) => {
    const equipment = await assertAvailable(tx, { roomId: input.roomId, startsAt: slot.startsAt, endsAt: slot.endsAt, equipment: input.equipment });
    const rp = await roomAndPlan(tx, input.roomId, input.ratePlanId, { requireActiveRoom: false });
    const priced = priceSlot(settings, rp, slot, equipment);

    let customer;
    if (input.customerId) {
      customer = await tx.customer.findUnique({ where: { id: input.customerId } });
      if (!customer) throw badRequest('Some fields need attention.', { customerId: 'Customer not found' });
    } else if (input.customer) {
      customer = await tx.customer.upsert({
        where: { email: input.customer.email },
        create: { name: input.customer.name, email: input.customer.email, phone: input.customer.phone, bandName: input.customer.bandName },
        update: {},
      });
    } else {
      throw badRequest('Choose an existing customer or enter their details.', { customer: 'Required' });
    }

    const created = await tx.booking.create({
      data: {
        reference: await newReference(tx),
        roomId: input.roomId,
        customerId: customer.id,
        status: 'CONFIRMED',
        source: 'ADMIN',
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        ratePlanId: rp.plan?.id ?? null,
        ratePlanName: rp.plan?.name ?? null,
        customerName: input.customer?.name ?? customer.name,
        customerEmail: customer.email,
        customerPhone: input.customer?.phone ?? customer.phone,
        bandName: input.customer?.bandName ?? customer.bandName,
        customerNotes: input.customerNotes,
        internalNotes: input.internalNotes,
        currency: settings.currency,
        roomSubtotalPence: priced.roomSubtotalPence,
        equipmentSubtotalPence: priced.equipmentSubtotalPence,
        totalPence: priced.totalPence,
        pricingSnapshot: priced.snapshot as unknown as Prisma.InputJsonValue,
        manageSalt: newManageSalt(),
        confirmedAt: new Date(),
        createdById: actorId,
        items: { create: priced.items },
      },
      include: { room: true },
    });
    let paid = 0;
    if (input.payment) {
      await recordManualPayment(created.id, input.payment, actorId, ip, tx);
      paid = input.payment.amountPence;
    }
    if (input.sendConfirmation) await enqueueEmail(confirmationEmail(created, settings, paid), tx);
    await audit({ action: 'booking.created_by_staff', actorId, targetType: 'booking', targetId: created.id, metadata: { reference: created.reference, ignoreBookingRules: input.ignoreBookingRules }, ipAddress: ip }, tx);
    return created;
  });
  flushOutboxSoon();
  return booking;
}

const sameEquipment = (a: { equipmentId: string; quantity: number }[], b: { equipmentId: string; quantity: number }[]) =>
  a.length === b.length && a.every((x) => b.some((y) => y.equipmentId === x.equipmentId && y.quantity === x.quantity));

export async function updateBooking(id: string, input: z.output<typeof adminBookingUpdateSchema>, actorId: string, ip: string | null) {
  const [settings, hours] = await Promise.all([getSettings(), getOpeningHours()]);
  const slot = resolveSlot(settings, input.date, input.startTime, input.durationMinutes);
  if (input.durationMinutes % 15 !== 0 || slot.startMinute % 15 !== 0) throw badRequest('Times must be in 15-minute steps.');
  if (!input.ignoreBookingRules) assertBookingRules(settings, hours, slot, 'staff');

  const updated = await withBookingTx(async (tx) => {
    const existing = await tx.booking.findUnique({ where: { id }, include: { items: true } });
    if (!existing) throw notFound('Booking not found.');
    if (existing.status !== 'CONFIRMED') throw conflict('Only confirmed bookings can be changed.');

    const durationChanged = existing.endsAt.getTime() - existing.startsAt.getTime() !== input.durationMinutes * 60000;
    const itemsChanged = !sameEquipment(existing.items, input.equipment);
    // Same room: keep its session type unless staff picked another.
    const ratePlanId = input.ratePlanId ?? (existing.roomId === input.roomId ? existing.ratePlanId : null);
    const rp = await roomAndPlan(tx, input.roomId, ratePlanId, { requireActiveRoom: false });
    const planChanged = (rp.plan?.id ?? null) !== existing.ratePlanId;
    if (input.pricing === 'KEEP' && (existing.roomId !== input.roomId || durationChanged || itemsChanged || planChanged)) {
      throw badRequest('Changing the room, session type, length or equipment changes the price — choose "Recalculate price".', { pricing: 'Recalculate required' });
    }

    const equipment = await assertAvailable(tx, {
      roomId: input.roomId,
      startsAt: slot.startsAt,
      endsAt: slot.endsAt,
      equipment: input.equipment,
      excludeBookingId: id,
      // Keep items that were already on the booking even if since deactivated.
      allowInactiveEquipment: true,
    });
    const priced = priceSlot(settings, rp, slot, equipment);

    const pricingData =
      input.pricing === 'RECALCULATE'
        ? {
            ratePlanId: rp.plan?.id ?? null,
            ratePlanName: rp.plan?.name ?? null,
            roomSubtotalPence: priced.roomSubtotalPence,
            equipmentSubtotalPence: priced.equipmentSubtotalPence,
            totalPence: priced.totalPence,
            pricingSnapshot: priced.snapshot as unknown as Prisma.InputJsonValue,
          }
        : {};
    if (input.pricing === 'RECALCULATE') {
      await tx.bookingEquipment.deleteMany({ where: { bookingId: id } });
      if (priced.items.length) await tx.bookingEquipment.createMany({ data: priced.items.map((i) => ({ ...i, bookingId: id })) });
    }

    const b = await tx.booking.update({
      where: { id },
      data: {
        roomId: input.roomId,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        customerName: input.customerName,
        customerEmail: input.customerEmail,
        customerPhone: input.customerPhone,
        bandName: input.bandName,
        customerNotes: input.customerNotes,
        internalNotes: input.internalNotes,
        ...pricingData,
      },
      include: { room: true },
    });
    const moved = existing.startsAt.getTime() !== b.startsAt.getTime() || existing.roomId !== b.roomId || durationChanged;
    if (input.notifyCustomer && (moved || itemsChanged)) await enqueueEmail(bookingChangedEmail(b, settings), tx);
    await audit({
      action: 'booking.updated',
      actorId,
      targetType: 'booking',
      targetId: id,
      metadata: {
        reference: b.reference,
        from: { roomId: existing.roomId, startsAt: existing.startsAt, endsAt: existing.endsAt, totalPence: existing.totalPence },
        to: { roomId: b.roomId, startsAt: b.startsAt, endsAt: b.endsAt, totalPence: b.totalPence },
        pricing: input.pricing,
      },
      ipAddress: ip,
    }, tx);
    return b;
  });
  flushOutboxSoon();
  return updated;
}

export async function cancelBooking(
  id: string,
  input: z.output<typeof cancelBookingSchema>,
  who: { actorId: string | null; by: 'staff' | 'customer'; ip: string | null },
) {
  const settings = await getSettings();
  const cancelled = await prisma.$transaction(async (tx) => {
    const b = await tx.booking.findUnique({ where: { id }, include: { payments: true } });
    if (!b) throw notFound('Booking not found.');
    if (!['CONFIRMED', 'PENDING_PAYMENT'].includes(b.status)) throw conflict('This booking is not active, so it cannot be cancelled.');
    const updated = await tx.booking.update({
      where: { id },
      data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledBy: who.by === 'customer' ? 'customer' : who.actorId, cancellationReason: input.reason, expiresAt: null },
      include: { room: true, payments: true },
    });
    await audit({ action: 'booking.cancelled', actorId: who.actorId, targetType: 'booking', targetId: id, metadata: { reference: b.reference, by: who.by, reason: input.reason, refund: input.refund }, ipAddress: who.ip }, tx);
    return updated;
  });

  // Refunds after the cancellation commits: a Stripe outage never leaves a booking half-cancelled.
  const refundable = cancelled.payments.filter((p) => p.status === 'SUCCEEDED' && p.amountPence > p.refundedPence);
  let toRefund = input.refund === 'FULL' ? refundable.reduce((s, p) => s + p.amountPence - p.refundedPence, 0) : input.refund === 'AMOUNT' ? (input.refundAmountPence ?? 0) : 0;
  let refunded = 0;
  const refundErrors: string[] = [];
  for (const p of refundable) {
    if (toRefund <= 0) break;
    const amount = Math.min(toRefund, p.amountPence - p.refundedPence);
    try {
      await refundPayment(p.id, amount, input.reason, who.actorId, who.ip);
      refunded += amount;
      toRefund -= amount;
    } catch (err) {
      refundErrors.push(err instanceof Error ? err.message : 'Refund failed');
    }
  }

  const b = await prisma.booking.findUniqueOrThrow({ where: { id }, include: { room: true } });
  if (input.notifyCustomer) await enqueueEmail(cancellationEmail(b, settings, refunded));
  if (settings.notifyOnCancellation && settings.adminNotifyEmail) {
    await enqueueEmail(adminCancellationEmail(b, settings, settings.adminNotifyEmail, who.by === 'customer' ? 'the customer' : 'staff'));
  }
  flushOutboxSoon();
  return { booking: b, refundedPence: refunded, refundErrors };
}

export async function setOutcome(id: string, outcome: 'COMPLETED' | 'NO_SHOW', actorId: string, ip: string | null) {
  const b = await prisma.booking.findUnique({ where: { id } });
  if (!b) throw notFound('Booking not found.');
  if (b.status !== 'CONFIRMED' && !(b.status === 'COMPLETED' && outcome === 'NO_SHOW') && !(b.status === 'NO_SHOW' && outcome === 'COMPLETED')) {
    throw conflict('Only confirmed bookings can be marked completed or no-show.');
  }
  if (b.startsAt > new Date()) throw conflict('This booking has not started yet.');
  const updated = await prisma.booking.update({
    where: { id },
    data: outcome === 'COMPLETED' ? { status: 'COMPLETED', completedAt: new Date(), noShowAt: null } : { status: 'NO_SHOW', noShowAt: new Date(), completedAt: null },
  });
  await audit({ action: outcome === 'COMPLETED' ? 'booking.completed' : 'booking.no_show', actorId, targetType: 'booking', targetId: id, metadata: { reference: b.reference }, ipAddress: ip });
  return updated;
}

export async function updateInternalNotes(id: string, internalNotes: string | null, actorId: string) {
  const b = await prisma.booking.update({ where: { id }, data: { internalNotes } }).catch(() => null);
  if (!b) throw notFound('Booking not found.');
  await audit({ action: 'booking.notes_updated', actorId, targetType: 'booking', targetId: id });
  return b;
}

export async function sendPaymentLink(id: string, actorId: string, ip: string | null) {
  const [b, settings] = await Promise.all([prisma.booking.findUnique({ where: { id }, include: { room: true, payments: true } }), getSettings()]);
  if (!b) throw notFound('Booking not found.');
  if (b.status !== 'CONFIRMED') throw conflict('Payment links can only be sent for confirmed bookings.');
  if (!integrations().stripe.enabled) throw serviceUnavailable('Stripe is not configured.');
  const balance = b.totalPence - paidPence(b.payments);
  if (balance < 50) throw badRequest('There is no balance to collect.');
  const checkout = await createCheckout(b, { amountPence: balance, expiresAt: new Date(Date.now() + 23.5 * 3600_000), purpose: 'balance' });
  await enqueueEmail(paymentLinkEmail(b, settings, checkout.url, balance));
  await audit({ action: 'payment.link_sent', actorId, targetType: 'booking', targetId: id, metadata: { amountPence: balance }, ipAddress: ip });
  flushOutboxSoon();
  return { url: checkout.url, amountPence: balance };
}

export async function resendConfirmation(id: string, actorId: string) {
  const [b, settings] = await Promise.all([prisma.booking.findUnique({ where: { id }, include: { room: true, payments: true } }), getSettings()]);
  if (!b) throw notFound('Booking not found.');
  if (b.status !== 'CONFIRMED') throw conflict('Only confirmed bookings have a confirmation to send.');
  await enqueueEmail(confirmationEmail(b, settings, paidPence(b.payments)));
  await audit({ action: 'booking.confirmation_resent', actorId, targetType: 'booking', targetId: id });
  flushOutboxSoon();
}

