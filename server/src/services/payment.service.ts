import type { PriceLine } from '@habitat/shared';
import type { Booking, Payment, Room } from '@prisma/client';
import type Stripe from 'stripe';
import { publicLink } from '../config/env';
import { prisma, type Tx } from '../db/prisma';
import { idOf, stripe } from '../stripe/client';
import { AppError, badRequest, notFound } from '../utils/errors';
import { logger } from '../utils/logger';
import { formatMoney } from '../utils/money';
import { audit } from './audit.service';
import { assertAvailable, lockBookings } from './availability.service';
import { enqueueEmail, flushOutboxSoon } from './email/outbox';
import { adminNewBookingEmail, confirmationEmail, latePaymentRefundedEmail } from './email/templates';
import { getSettings } from './settings.service';

export type AfterCommit = () => Promise<void>;

/** Money actually held for a booking: succeeded payments minus refunds. */
export function paidPence(payments: Pick<Payment, 'status' | 'amountPence' | 'refundedPence'>[]) {
  return payments.filter((p) => p.status === 'SUCCEEDED').reduce((s, p) => s + p.amountPence - p.refundedPence, 0);
}

function stripeUnavailable(err: unknown): AppError {
  if (err instanceof AppError) return err;
  logger.error({ err }, 'Stripe request failed');
  return new AppError(503, 'payments_unavailable', 'Online payment is temporarily unavailable. Your booking has not been taken — please try again in a few minutes or contact us.');
}

// ---------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------

/**
 * Create a Stripe Checkout session for `amountPence` of a booking. Amounts come from
 * the booking's server-side pricing snapshot, never from the browser.
 */
export async function createCheckout(
  booking: Booking & { room: Room },
  opts: { amountPence: number; expiresAt: Date; purpose: 'booking' | 'balance' },
): Promise<{ url: string; sessionId: string }> {
  const lines = ((booking.pricingSnapshot as { lines?: PriceLine[] })?.lines ?? []) as PriceLine[];
  // Stripe line items can't be negative, so a booking with a discount (promo code, longer-booking
  // discount) is sent as one item for the total, with the breakdown in its description.
  const hasDiscount = lines.some((l) => l.amountPence < 0);
  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] =
    opts.purpose === 'booking' && !hasDiscount
      ? lines.map((l) => ({
          quantity: 1,
          price_data: { currency: booking.currency, unit_amount: l.amountPence, product_data: { name: l.description.slice(0, 250) } },
        }))
      : opts.purpose === 'booking'
        ? [
            {
              quantity: 1,
              price_data: {
                currency: booking.currency,
                unit_amount: opts.amountPence,
                product_data: {
                  name: `Booking ${booking.reference} — ${booking.room.name}`.slice(0, 250),
                  description: lines.map((l) => `${l.description}: ${l.amountPence < 0 ? '−' : ''}${formatMoney(Math.abs(l.amountPence), booking.currency)}`).join(' · ').slice(0, 1000),
                },
              },
            },
          ]
        : [
          {
            quantity: 1,
            price_data: {
              currency: booking.currency,
              unit_amount: opts.amountPence,
              product_data: { name: `Balance for booking ${booking.reference} — ${booking.room.name}` },
            },
          },
        ];
  if (opts.purpose === 'booking' && lineItems.reduce((s, l) => s + (l.price_data?.unit_amount ?? 0), 0) !== opts.amountPence) {
    throw new Error('Checkout line items do not add up to the booking total');
  }

  let session: Stripe.Checkout.Session;
  try {
    session = await stripe().checkout.sessions.create(
      {
        mode: 'payment',
        line_items: lineItems,
        customer_email: booking.customerEmail,
        client_reference_id: booking.id,
        metadata: { bookingId: booking.id, reference: booking.reference, purpose: opts.purpose },
        payment_intent_data: { metadata: { bookingId: booking.id, reference: booking.reference }, description: `Booking ${booking.reference}` },
        expires_at: Math.floor(opts.expiresAt.getTime() / 1000),
        // The return page only *displays* status; confirmation comes from the webhook.
        success_url: publicLink(`/booking/${booking.reference}?session_id={CHECKOUT_SESSION_ID}`),
        cancel_url: publicLink(`/booking/${booking.reference}?cancelled=1`),
      },
      { idempotencyKey: `habitat-checkout-${booking.id}-${opts.purpose}-${opts.amountPence}-${opts.expiresAt.getTime()}` },
    );
  } catch (err) {
    throw stripeUnavailable(err);
  }
  if (!session.url) throw stripeUnavailable(new Error('Stripe returned no checkout URL'));

  await prisma.payment.create({
    data: {
      bookingId: booking.id,
      method: 'STRIPE',
      status: 'PENDING',
      amountPence: opts.amountPence,
      currency: booking.currency,
      stripeCheckoutSessionId: session.id,
    },
  });
  return { url: session.url, sessionId: session.id };
}

// ---------------------------------------------------------------------------
// Applying a paid checkout (webhook and reconciliation share this)
// ---------------------------------------------------------------------------

export type PaidOutcome = 'confirmed' | 'recorded' | 'already_applied' | 'late_refunded' | 'unknown_session';

/**
 * Record a completed, paid Checkout session and confirm its booking. Must run inside
 * a transaction; takes the booking lock. Returns work to run after commit.
 */
export async function applyPaidCheckout(tx: Tx, session: Stripe.Checkout.Session): Promise<{ outcome: PaidOutcome; after: AfterCommit[] }> {
  await lockBookings(tx);
  const after: AfterCommit[] = [];

  let payment = await tx.payment.findUnique({ where: { stripeCheckoutSessionId: session.id } });
  if (!payment) {
    const bookingId = session.metadata?.bookingId ?? session.client_reference_id;
    const booking = bookingId ? await tx.booking.findUnique({ where: { id: bookingId } }) : null;
    if (!booking) {
      logger.warn({ session: session.id }, 'Paid checkout for an unknown booking');
      return { outcome: 'unknown_session', after };
    }
    payment = await tx.payment.create({
      data: { bookingId: booking.id, method: 'STRIPE', status: 'PENDING', amountPence: session.amount_total ?? 0, currency: session.currency ?? booking.currency, stripeCheckoutSessionId: session.id },
    });
  }
  if (payment.status === 'SUCCEEDED') return { outcome: 'already_applied', after };

  const paymentIntentId = idOf(session.payment_intent);
  payment = await tx.payment.update({
    where: { id: payment.id },
    data: { status: 'SUCCEEDED', amountPence: session.amount_total ?? payment.amountPence, stripePaymentIntentId: paymentIntentId, paidAt: new Date() },
  });

  const booking = await tx.booking.findUniqueOrThrow({ where: { id: payment.bookingId }, include: { room: true, items: true, payments: true } });
  const settings = await getSettings(tx);
  let outcome: PaidOutcome = 'recorded';

  if (booking.status === 'PENDING_PAYMENT' || booking.status === 'EXPIRED' || (booking.status === 'CANCELLED' && booking.cancelledBy === 'customer-abandoned')) {
    // The hold may have lapsed. Reinstate only if the room and equipment are still free.
    let free = true;
    if (booking.status !== 'PENDING_PAYMENT' || (booking.expiresAt && booking.expiresAt < new Date())) {
      try {
        await assertAvailable(tx, {
          roomId: booking.roomId,
          startsAt: booking.startsAt,
          endsAt: booking.endsAt,
          equipment: booking.items.map((i) => ({ equipmentId: i.equipmentId, quantity: i.quantity })),
          excludeBookingId: booking.id,
          allowInactiveEquipment: true,
        });
      } catch {
        free = false;
      }
    }
    if (free) {
      const confirmed = await tx.booking.update({
        where: { id: booking.id },
        data: { status: 'CONFIRMED', confirmedAt: new Date(), expiresAt: null, cancelledAt: null, cancelledBy: null, cancellationReason: null },
        include: { room: true },
      });
      outcome = 'confirmed';
      const paid = paidPence(booking.payments.map((p) => (p.id === payment!.id ? payment! : p)));
      await enqueueEmail(confirmationEmail(confirmed, settings, paid), tx);
      if (settings.notifyOnNewBooking && settings.adminNotifyEmail) await enqueueEmail(adminNewBookingEmail(confirmed, settings, settings.adminNotifyEmail), tx);
      await audit({ action: 'booking.confirmed', targetType: 'booking', targetId: booking.id, metadata: { reference: booking.reference, paymentId: payment.id, amountPence: payment.amountPence } }, tx);
    } else {
      await tx.booking.update({
        where: { id: booking.id },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledBy: 'system', cancellationReason: 'Payment arrived after the reservation expired and the time was no longer available.' },
      });
      outcome = 'late_refunded';
      const paymentId = payment.id;
      const amount = payment.amountPence;
      after.push(async () => {
        try {
          await refundPayment(paymentId, amount, 'Late payment — slot no longer available', null);
          const b = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id }, include: { room: true } });
          await enqueueEmail(latePaymentRefundedEmail(b, settings, amount));
          flushOutboxSoon();
        } catch (err) {
          logger.error({ err, bookingId: booking.id }, 'Automatic refund of late payment failed — refund manually from the booking page');
          await audit({ action: 'payment.refund_failed', targetType: 'booking', targetId: booking.id, metadata: { paymentId, amount } });
        }
      });
      await audit({ action: 'booking.late_payment', targetType: 'booking', targetId: booking.id, metadata: { reference: booking.reference, paymentId } }, tx);
    }
  } else {
    await audit({ action: 'payment.received', targetType: 'booking', targetId: booking.id, metadata: { reference: booking.reference, paymentId: payment.id, amountPence: payment.amountPence } }, tx);
  }
  after.push(async () => flushOutboxSoon());
  return { outcome, after };
}

/** A checkout expired unpaid: release the booking's hold. */
export async function applyExpiredCheckout(tx: Tx, session: Stripe.Checkout.Session) {
  const payment = await tx.payment.findUnique({ where: { stripeCheckoutSessionId: session.id } });
  if (!payment || payment.status !== 'PENDING') return;
  await tx.payment.update({ where: { id: payment.id }, data: { status: 'EXPIRED' } });
  const booking = await tx.booking.findUnique({ where: { id: payment.bookingId } });
  if (booking?.status === 'PENDING_PAYMENT') {
    await tx.booking.update({ where: { id: booking.id }, data: { status: 'EXPIRED' } });
    await audit({ action: 'booking.expired', targetType: 'booking', targetId: booking.id, metadata: { reference: booking.reference } }, tx);
  }
}

/**
 * Ask Stripe directly about a pending checkout. A server-to-Stripe check is as
 * authoritative as the webhook, and covers webhooks delayed by an internet outage.
 */
export async function reconcilePayment(paymentId: string) {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment?.stripeCheckoutSessionId || payment.status !== 'PENDING') return 'nothing_to_do';
  let session: Stripe.Checkout.Session;
  try {
    session = await stripe().checkout.sessions.retrieve(payment.stripeCheckoutSessionId);
  } catch (err) {
    throw stripeUnavailable(err);
  }
  if (session.status === 'complete' && session.payment_status !== 'unpaid') {
    const result = await prisma.$transaction((tx) => applyPaidCheckout(tx, session), { timeout: 20_000 });
    for (const fn of result.after) await fn();
    return result.outcome;
  }
  if (session.status === 'expired') {
    await prisma.$transaction((tx) => applyExpiredCheckout(tx, session));
    return 'expired';
  }
  return 'still_open';
}

export async function reconcilePendingPayments() {
  const pending = await prisma.payment.findMany({
    where: { status: 'PENDING', method: 'STRIPE', createdAt: { lt: new Date(Date.now() - 2 * 60_000) } },
    select: { id: true },
    take: 50,
  });
  for (const p of pending) {
    try {
      await reconcilePayment(p.id);
    } catch (err) {
      logger.warn({ err, paymentId: p.id }, 'Payment reconciliation failed');
    }
  }
}

// ---------------------------------------------------------------------------
// Refunds & manual payments
// ---------------------------------------------------------------------------

/** Re-read the refunded total from Stripe (absolute, so repeated syncs are harmless). */
export async function syncStripeRefunds(paymentIntentId: string, amountRefunded?: number) {
  const payment = await prisma.payment.findUnique({ where: { stripePaymentIntentId: paymentIntentId } });
  if (!payment) return;
  let refunded = amountRefunded;
  if (refunded === undefined) {
    const pi = await stripe().paymentIntents.retrieve(paymentIntentId, { expand: ['latest_charge'] });
    const charge = pi.latest_charge;
    refunded = charge && typeof charge === 'object' ? charge.amount_refunded : 0;
  }
  await prisma.payment.update({ where: { id: payment.id }, data: { refundedPence: Math.min(refunded, payment.amountPence) } });
}

export async function refundPayment(paymentId: string, amountPence: number, reason: string | null, actorId: string | null, ip: string | null = null) {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment) throw notFound('Payment not found.');
  if (payment.status !== 'SUCCEEDED') throw badRequest('Only completed payments can be refunded.');
  const refundable = payment.amountPence - payment.refundedPence;
  if (amountPence > refundable) throw badRequest(`At most ${refundable / 100} can be refunded from this payment.`, { amountPence: 'Too much' });

  if (payment.method === 'STRIPE') {
    if (!payment.stripePaymentIntentId) throw badRequest('This payment has no Stripe payment intent.');
    try {
      await stripe().refunds.create(
        { payment_intent: payment.stripePaymentIntentId, amount: amountPence, metadata: { bookingId: payment.bookingId, reason: reason ?? '' } },
        { idempotencyKey: `habitat-refund-${payment.id}-${payment.refundedPence}-${amountPence}` },
      );
      await syncStripeRefunds(payment.stripePaymentIntentId);
    } catch (err) {
      if (err instanceof AppError) throw err;
      logger.error({ err, paymentId }, 'Stripe refund failed');
      throw new AppError(502, 'refund_failed', 'Stripe could not process the refund. Nothing was refunded — try again shortly.');
    }
  } else {
    // Cash / terminal / transfer refunds are handed back in person; record them.
    await prisma.payment.update({ where: { id: payment.id }, data: { refundedPence: payment.refundedPence + amountPence } });
  }
  await audit({ action: 'payment.refunded', actorId, targetType: 'booking', targetId: payment.bookingId, metadata: { paymentId, amountPence, method: payment.method, reason }, ipAddress: ip });
  return prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
}

export async function recordManualPayment(bookingId: string, input: { method: Payment['method']; amountPence: number; note: string | null }, actorId: string, ip: string | null, tx: Tx = prisma) {
  const booking = await tx.booking.findUnique({ where: { id: bookingId }, include: { payments: true } });
  if (!booking) throw notFound('Booking not found.');
  if (booking.status === 'CANCELLED' || booking.status === 'EXPIRED') throw badRequest('Cannot take payment for a cancelled booking.');
  const balance = booking.totalPence - paidPence(booking.payments);
  if (input.amountPence > balance) throw badRequest(`The outstanding balance is ${balance / 100}.`, { amountPence: 'More than the balance due' });
  const payment = await tx.payment.create({
    data: { bookingId, method: input.method, status: 'SUCCEEDED', amountPence: input.amountPence, currency: booking.currency, note: input.note, recordedById: actorId, paidAt: new Date() },
  });
  await audit({ action: 'payment.recorded', actorId, targetType: 'booking', targetId: bookingId, metadata: { method: input.method, amountPence: input.amountPence }, ipAddress: ip }, tx);
  return payment;
}
