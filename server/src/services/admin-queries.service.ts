import {
  ACTIVE_BOOKING_STATUSES,
  BOOKING_STATUSES,
  type BookingDetailDto,
  type BookingStatus,
  type BookingSummaryDto,
  type CalendarResponse,
  type DashboardResponse,
  type PaymentDto,
  type PriceLine,
} from '@habitat/shared';
import type { Booking, Customer, Payment, Prisma, Room } from '@prisma/client';
import { env } from '../config/env';
import { prisma } from '../db/prisma';
import { badRequest, notFound } from '../utils/errors';
import { addDays, fromLocal, isValidDate, toLocal } from '../utils/time';
import { toBlockDto } from './catalogue.service';
import { smtpConfigured } from './email/transport';
import { paidPence } from './payment.service';
import { getOpeningHours, getSettings, openingHoursDto } from './settings.service';
import { integrations } from '../config/integrations';

type BookingWithRefs = Booking & { room: Room; customer: Customer; payments: Payment[] };

export const toPaymentDto = (p: Payment & { booking?: { reference: string; customerName: string } }): PaymentDto => ({
  id: p.id,
  bookingId: p.bookingId,
  bookingReference: p.booking?.reference,
  customerName: p.booking?.customerName,
  method: p.method,
  status: p.status,
  amountPence: p.amountPence,
  refundedPence: p.refundedPence,
  currency: p.currency,
  note: p.note,
  stripePaymentIntentId: p.stripePaymentIntentId,
  paidAt: p.paidAt?.toISOString() ?? null,
  createdAt: p.createdAt.toISOString(),
});

export const toBookingSummary = (b: BookingWithRefs): BookingSummaryDto => ({
  id: b.id,
  reference: b.reference,
  status: b.status,
  source: b.source,
  room: { id: b.room.id, name: b.room.name, colour: b.room.colour },
  customer: { id: b.customer.id, name: b.customerName, email: b.customerEmail },
  bandName: b.bandName,
  startsAt: b.startsAt.toISOString(),
  endsAt: b.endsAt.toISOString(),
  totalPence: b.totalPence,
  paidPence: paidPence(b.payments),
  currency: b.currency,
  createdAt: b.createdAt.toISOString(),
});

const include = { room: true, customer: true, payments: true } satisfies Prisma.BookingInclude;

export async function listBookings(q: { status?: string; from?: string; to?: string; roomId?: string; q?: string }) {
  const s = await getSettings();
  const where: Prisma.BookingWhereInput = {};
  if (q.status === 'active') where.status = { in: [...ACTIVE_BOOKING_STATUSES] };
  else if (q.status && (BOOKING_STATUSES as readonly string[]).includes(q.status)) where.status = q.status as BookingStatus;
  if (q.from) where.startsAt = { gte: fromLocal(q.from, 0, s.timezone) };
  if (q.to) where.endsAt = { lte: fromLocal(addDays(q.to, 1), 0, s.timezone) };
  if (q.roomId) where.roomId = q.roomId;
  if (q.q) {
    where.OR = [
      { reference: { contains: q.q, mode: 'insensitive' } },
      { customerName: { contains: q.q, mode: 'insensitive' } },
      { customerEmail: { contains: q.q, mode: 'insensitive' } },
      { bandName: { contains: q.q, mode: 'insensitive' } },
    ];
  }
  const rows = await prisma.booking.findMany({ where, include, orderBy: { startsAt: q.from ? 'asc' : 'desc' }, take: 500 });
  return rows.map(toBookingSummary);
}

export async function bookingDetail(id: string): Promise<BookingDetailDto> {
  const b = await prisma.booking.findUnique({ where: { id }, include: { ...include, items: true } });
  if (!b) throw notFound('Booking not found.');
  const [emails, history, staff] = await Promise.all([
    prisma.emailMessage.findMany({ where: { bookingId: id }, orderBy: { createdAt: 'desc' } }),
    prisma.auditLog.findMany({ where: { targetType: 'booking', targetId: id }, orderBy: { createdAt: 'asc' }, include: { actor: { select: { name: true } } } }),
    b.cancelledBy && b.cancelledBy !== 'customer' && b.cancelledBy !== 'system' && b.cancelledBy !== 'customer-abandoned'
      ? prisma.staffUser.findUnique({ where: { id: b.cancelledBy }, select: { name: true } })
      : null,
  ]);
  const summary = toBookingSummary(b);
  return {
    ...summary,
    ratePlanId: b.ratePlanId,
    ratePlanName: b.ratePlanName,
    customerName: b.customerName,
    customerEmail: b.customerEmail,
    customerPhone: b.customerPhone,
    customerNotes: b.customerNotes,
    internalNotes: b.internalNotes,
    roomSubtotalPence: b.roomSubtotalPence,
    equipmentSubtotalPence: b.equipmentSubtotalPence,
    lines: ((b.pricingSnapshot as { lines?: PriceLine[] })?.lines ?? []) as PriceLine[],
    items: b.items.map((i) => ({ equipmentId: i.equipmentId, name: i.name, quantity: i.quantity, lineTotalPence: i.lineTotalPence })),
    payments: b.payments.sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime()).map((p) => toPaymentDto(p)),
    expiresAt: b.expiresAt?.toISOString() ?? null,
    confirmedAt: b.confirmedAt?.toISOString() ?? null,
    cancelledAt: b.cancelledAt?.toISOString() ?? null,
    cancelledBy: staff?.name ?? (b.cancelledBy === 'customer' ? 'Customer (online)' : b.cancelledBy === 'customer-abandoned' ? 'Customer (before paying)' : b.cancelledBy === 'system' ? 'System' : null),
    cancellationReason: b.cancellationReason,
    completedAt: b.completedAt?.toISOString() ?? null,
    noShowAt: b.noShowAt?.toISOString() ?? null,
    refundablePence: b.payments.filter((p) => p.status === 'SUCCEEDED').reduce((s, p) => s + p.amountPence - p.refundedPence, 0),
    emails: emails.map((e) => ({ id: e.id, kind: e.kind, status: e.status, to: e.to, createdAt: e.createdAt.toISOString(), sentAt: e.sentAt?.toISOString() ?? null, lastError: e.lastError })),
    history: history.map((h) => ({ action: h.action, actor: h.actor?.name ?? null, createdAt: h.createdAt.toISOString() })),
  };
}

/** Everything on the calendar between two local dates (inclusive). */
export async function calendar(from: string, to: string): Promise<CalendarResponse> {
  if (!isValidDate(from) || !isValidDate(to) || to < from) throw badRequest('Invalid date range');
  if (addDays(from, 62) < to) throw badRequest('Choose a range of up to two months');
  const [s, hours] = await Promise.all([getSettings(), getOpeningHours()]);
  const start = fromLocal(from, 0, s.timezone);
  const end = fromLocal(addDays(to, 1), 0, s.timezone);
  const [rooms, bookings, blocks] = await Promise.all([
    prisma.room.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    prisma.booking.findMany({
      where: { startsAt: { lt: end }, endsAt: { gt: start }, status: { in: ['PENDING_PAYMENT', 'CONFIRMED', 'COMPLETED', 'NO_SHOW'] } },
      include,
      orderBy: { startsAt: 'asc' },
    }),
    prisma.availabilityBlock.findMany({ where: { startsAt: { lt: end }, endsAt: { gt: start } }, include: { room: true } }),
  ]);
  return {
    from,
    to,
    timezone: s.timezone,
    rooms: rooms.map((r) => ({ id: r.id, name: r.name, colour: r.colour, active: r.active })),
    bookings: bookings.filter((b) => !(b.status === 'PENDING_PAYMENT' && b.expiresAt && b.expiresAt < new Date())).map(toBookingSummary),
    blocks: blocks.map(toBlockDto),
    openingHours: openingHoursDto(hours),
  };
}

export async function dashboard(): Promise<DashboardResponse> {
  const [s, hours] = await Promise.all([getSettings(), getOpeningHours()]);
  const today = toLocal(new Date(), s.timezone).date;
  const start = fromLocal(today, 0, s.timezone);
  const end = fromLocal(addDays(today, 1), 0, s.timezone);
  const [todays, upcomingCount, pendingPayments, owing, emailProblems, rooms] = await Promise.all([
    prisma.booking.findMany({ where: { startsAt: { lt: end }, endsAt: { gt: start }, status: { in: ['CONFIRMED', 'COMPLETED', 'NO_SHOW', 'PENDING_PAYMENT'] } }, include, orderBy: { startsAt: 'asc' } }),
    prisma.booking.count({ where: { status: 'CONFIRMED', startsAt: { gte: end } } }),
    prisma.booking.count({ where: { status: 'PENDING_PAYMENT', expiresAt: { gt: new Date() } } }),
    prisma.booking.findMany({ where: { status: { in: ['CONFIRMED', 'COMPLETED'] } }, select: { totalPence: true, payments: { select: { status: true, amountPence: true, refundedPence: true } } } }),
    prisma.emailMessage.count({ where: { OR: [{ status: 'FAILED' }, { status: 'PENDING', attempts: { gt: 0 } }] } }),
    prisma.room.count({ where: { active: true } }),
  ]);
  const balances = owing.map((b) => b.totalPence - paidPence(b.payments)).filter((x) => x > 0);
  return {
    today,
    todaysBookings: todays.map(toBookingSummary),
    upcomingCount,
    pendingPayments,
    outstandingBalances: { count: balances.length, totalPence: balances.reduce((a, b) => a + b, 0) },
    emailProblems,
    setup: { rooms: rooms > 0, openingHours: hours.some((h) => h.isOpen), stripe: integrations().stripe.enabled, smtp: smtpConfigured(), adminEmail: Boolean(s.adminNotifyEmail) },
  };
}

export async function listPayments(limit = 300) {
  const rows = await prisma.payment.findMany({
    where: { status: { in: ['SUCCEEDED', 'PENDING', 'FAILED'] } },
    include: { booking: { select: { reference: true, customerName: true } } },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  return rows.map(toPaymentDto);
}

export async function customerDetail(id: string) {
  const c = await prisma.customer.findUnique({ where: { id } });
  if (!c) throw notFound('Customer not found.');
  const bookings = await prisma.booking.findMany({ where: { customerId: id }, include, orderBy: { startsAt: 'desc' } });
  return {
    customer: { id: c.id, name: c.name, email: c.email, phone: c.phone, bandName: c.bandName, notes: c.notes, createdAt: c.createdAt.toISOString(), bookingCount: bookings.length, lastBookingAt: bookings[0]?.startsAt.toISOString() ?? null },
    bookings: bookings.map(toBookingSummary),
    totals: {
      paidPence: bookings.reduce((s, b) => s + paidPence(b.payments), 0),
      cancelled: bookings.filter((b) => b.status === 'CANCELLED').length,
      noShows: bookings.filter((b) => b.status === 'NO_SHOW').length,
    },
  };
}
