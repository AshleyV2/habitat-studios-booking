import {
  ACTIVE_BOOKING_STATUSES,
  minutesToTime,
  planDurations,
  planWindow,
  timeToMinutes,
  type RatePlan,
  type AvailabilityResponse,
  type EquipmentAvailability,
} from '@habitat/shared';
import type { OpeningHours, Prisma, Settings } from '@prisma/client';
import { prisma, type Tx } from '../db/prisma';
import { AppError, badRequest, notFound } from '../utils/errors';
import { addDays, dayOfWeekOf, fromLocal, isValidDate, localTimeLabel, toLocal } from '../utils/time';
import { resolveRatePlan } from './pricing.service';
import { getOpeningHours, getSettings } from './settings.service';

/** Serialises every booking write (create, move, confirm) across the installation. */
const BOOKING_LOCK_KEY = 7211_0001;

export async function lockBookings(tx: Tx) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${BOOKING_LOCK_KEY}::bigint)`;
}

/** Bookings that occupy their room/equipment right now (a lapsed payment hold does not). */
export function occupyingWhere(now = new Date()): Prisma.BookingWhereInput {
  return {
    status: { in: [...ACTIVE_BOOKING_STATUSES] },
    NOT: { status: 'PENDING_PAYMENT', expiresAt: { lt: now } },
  };
}

/** Release lapsed payment holds. Runs inside booking transactions and on a timer. */
export async function expireStaleHolds(tx: Tx, now = new Date()) {
  const stale = await tx.booking.findMany({
    where: { status: 'PENDING_PAYMENT', expiresAt: { lt: now } },
    select: { id: true },
  });
  if (!stale.length) return 0;
  const ids = stale.map((b) => b.id);
  await tx.booking.updateMany({ where: { id: { in: ids } }, data: { status: 'EXPIRED' } });
  await tx.payment.updateMany({ where: { bookingId: { in: ids }, status: 'PENDING' }, data: { status: 'EXPIRED' } });
  return ids.length;
}

// ---------------------------------------------------------------------------
// Slot resolution & rules
// ---------------------------------------------------------------------------

export interface ResolvedSlot {
  date: string;
  startMinute: number;
  durationMinutes: number;
  startsAt: Date;
  endsAt: Date;
}

export function resolveSlot(settings: Settings, date: string, startTime: string, durationMinutes: number): ResolvedSlot {
  if (!isValidDate(date)) throw badRequest('Some fields need attention.', { date: 'Enter a valid date' });
  const startMinute = timeToMinutes(startTime);
  const startsAt = fromLocal(date, startMinute, settings.timezone);
  // Elapsed-time duration, so bookings across a DST change are still the length paid for.
  const endsAt = new Date(startsAt.getTime() + durationMinutes * 60000);
  return { date, startMinute, durationMinutes, startsAt, endsAt };
}

function dayWindow(settings: Settings, hours: OpeningHours[], date: string) {
  const day = hours.find((h) => h.dayOfWeek === dayOfWeekOf(date));
  if (!day?.isOpen) return null;
  return {
    openMinute: day.openMinute,
    closeMinute: day.closeMinute,
    openAt: fromLocal(date, day.openMinute, settings.timezone),
    closeAt: fromLocal(date, day.closeMinute, settings.timezone),
  };
}

/**
 * Booking rules. 'customer' applies everything (duration steps, opening hours, notice,
 * advance window); 'staff' only requires the booking to sit within opening hours.
 * Staff can bypass even that with ignoreBookingRules. Conflicts are never bypassable.
 */
export function assertBookingRules(
  settings: Settings,
  hours: OpeningHours[],
  slot: ResolvedSlot,
  mode: 'customer' | 'staff',
  now = new Date(),
  plan: RatePlan | null = null,
  /** The room's own minimum (hourly pricing); null = the site-wide one. */
  roomMinMinutes: number | null = null,
) {
  const { durationMinutes: d, startMinute } = slot;
  if (mode === 'customer' && plan) {
    // A session type sets its own lengths and hours (e.g. solo: 1 h+, ending by 18:00).
    if (!planDurations(plan, settings).includes(d)) {
      throw badRequest(`${plan.name} sessions can't be booked for that length.`, { durationMinutes: 'Choose a listed length' });
    }
    if (startMinute % settings.slotMinutes !== 0) throw badRequest('Choose one of the listed start times.', { startTime: 'Invalid start time' });
    const w = planWindow(plan);
    if ((w.earliestStart !== null && startMinute < w.earliestStart) || (w.latestEnd !== null && startMinute + d > w.latestEnd)) {
      throw new AppError(409, 'outside_plan_hours', `${plan.name} sessions run ${plan.earliestStartTime ?? 'from opening'} to ${plan.latestEndTime ?? 'closing'}.`);
    }
  } else if (mode === 'customer') {
    const min = Math.max(roomMinMinutes ?? settings.minDurationMinutes, settings.slotMinutes);
    if (d < min || d > settings.maxDurationMinutes || d % settings.slotMinutes !== 0) {
      throw badRequest(
        `Bookings must be between ${min / 60} and ${settings.maxDurationMinutes / 60} hours, in ${settings.slotMinutes}-minute steps.`,
        { durationMinutes: 'Choose a valid duration' },
      );
    }
    if (startMinute % settings.slotMinutes !== 0) throw badRequest('Choose one of the listed start times.', { startTime: 'Invalid start time' });
  }
  const window = dayWindow(settings, hours, slot.date);
  if (!window || slot.startsAt < window.openAt || slot.endsAt > window.closeAt) {
    throw new AppError(409, 'outside_opening_hours', 'That time is outside our opening hours.');
  }
  if (mode === 'staff') return;
  if (slot.startsAt.getTime() < now.getTime() + settings.minNoticeMinutes * 60000) {
    throw new AppError(409, 'too_soon', `Online bookings need at least ${Math.round((settings.minNoticeMinutes / 60) * 10) / 10} hours' notice. Please call us for sooner sessions.`);
  }
  const today = toLocal(now, settings.timezone).date;
  if (slot.date > addDays(today, settings.maxAdvanceDays)) {
    throw new AppError(409, 'too_far_ahead', `Bookings open ${settings.maxAdvanceDays} days in advance.`);
  }
}

// ---------------------------------------------------------------------------
// Conflicts
// ---------------------------------------------------------------------------

export async function roomConflicts(tx: Tx, roomId: string, startsAt: Date, endsAt: Date, excludeBookingId?: string) {
  const [bookings, blocks] = await Promise.all([
    tx.booking.count({
      where: {
        ...occupyingWhere(),
        roomId,
        startsAt: { lt: endsAt },
        endsAt: { gt: startsAt },
        ...(excludeBookingId ? { id: { not: excludeBookingId } } : {}),
      },
    }),
    tx.availabilityBlock.count({
      where: { OR: [{ roomId }, { roomId: null }], startsAt: { lt: endsAt }, endsAt: { gt: startsAt } },
    }),
  ]);
  return { bookings, blocks };
}

/**
 * Highest number of units of each item in use at any single moment in [start, end).
 * Using the peak (not the sum) means two back-to-back bookings that each overlap the
 * window do not double-count units that are never out at the same time.
 */
export async function equipmentPeakUsage(tx: Tx, startsAt: Date, endsAt: Date, excludeBookingId?: string) {
  const rows = await tx.bookingEquipment.findMany({
    where: {
      booking: {
        ...occupyingWhere(),
        startsAt: { lt: endsAt },
        endsAt: { gt: startsAt },
        ...(excludeBookingId ? { id: { not: excludeBookingId } } : {}),
      },
    },
    select: { equipmentId: true, quantity: true, booking: { select: { startsAt: true, endsAt: true } } },
  });
  const byItem = new Map<string, { t: number; delta: number }[]>();
  for (const r of rows) {
    const s = Math.max(r.booking.startsAt.getTime(), startsAt.getTime());
    const e = Math.min(r.booking.endsAt.getTime(), endsAt.getTime());
    const ev = byItem.get(r.equipmentId) ?? [];
    ev.push({ t: s, delta: r.quantity }, { t: e, delta: -r.quantity });
    byItem.set(r.equipmentId, ev);
  }
  const peak = new Map<string, number>();
  for (const [id, events] of byItem) {
    // Releases sort before acquisitions at the same instant ([start, end) ranges).
    events.sort((a, b) => a.t - b.t || a.delta - b.delta);
    let cur = 0;
    let max = 0;
    for (const e of events) {
      cur += e.delta;
      max = Math.max(max, cur);
    }
    peak.set(id, max);
  }
  return peak;
}

/**
 * Validate that a room and equipment are free. Must run inside a transaction that
 * holds lockBookings(); the database exclusion constraint backs up the room check.
 */
export async function assertAvailable(
  tx: Tx,
  args: { roomId: string; startsAt: Date; endsAt: Date; equipment: { equipmentId: string; quantity: number }[]; excludeBookingId?: string; allowInactiveEquipment?: boolean },
) {
  const conflicts = await roomConflicts(tx, args.roomId, args.startsAt, args.endsAt, args.excludeBookingId);
  if (conflicts.bookings || conflicts.blocks) {
    throw new AppError(409, 'slot_unavailable', 'Sorry — that time has just been booked or is no longer available. Please choose another time.');
  }
  if (!args.equipment.length) return [];

  const items = await tx.equipment.findMany({ where: { id: { in: args.equipment.map((e) => e.equipmentId) } } });
  const usage = await equipmentPeakUsage(tx, args.startsAt, args.endsAt, args.excludeBookingId);
  const fields: Record<string, string> = {};
  const resolved = args.equipment.map((sel) => {
    const item = items.find((i) => i.id === sel.equipmentId);
    if (!item || (!item.active && !args.allowInactiveEquipment)) {
      fields[`equipment.${sel.equipmentId}`] = 'This item is not available';
      return null;
    }
    const free = item.quantity - (usage.get(item.id) ?? 0);
    if (sel.quantity > free) {
      fields[`equipment.${sel.equipmentId}`] = free > 0 ? `Only ${free} available at that time` : 'None available at that time';
    }
    return { item, quantity: sel.quantity };
  });
  if (Object.keys(fields).length) {
    throw new AppError(409, 'equipment_unavailable', 'Some equipment is not available for that time.', fields);
  }
  return resolved.filter((r): r is NonNullable<typeof r> => r !== null);
}

// ---------------------------------------------------------------------------
// Read models for the booking page
// ---------------------------------------------------------------------------

export async function getDayAvailability(roomId: string, date: string, now = new Date(), ratePlanId?: string | null): Promise<AvailabilityResponse> {
  if (!isValidDate(date)) throw badRequest('Enter a valid date');
  const [settings, hours, room] = await Promise.all([getSettings(), getOpeningHours(), prisma.room.findUnique({ where: { id: roomId } })]);
  if (!room || !room.active) throw notFound('Room not found.');
  // Lengths and hours come from the session type when the room has them.
  const plan = resolveRatePlan(room, ratePlanId);
  const lengths = plan ? planDurations(plan, settings) : null;
  const minLength = lengths ? (lengths[0] ?? Infinity) : Math.max(room.minDurationMinutes ?? settings.minDurationMinutes, settings.slotMinutes);
  const maxLength = lengths ? (lengths.at(-1) ?? 0) : settings.maxDurationMinutes;
  const pw = plan ? planWindow(plan) : { earliestStart: null, latestEnd: null };

  const empty = (reason: string, window?: { openMinute: number; closeMinute: number }): AvailabilityResponse => ({
    date,
    roomId,
    open: Boolean(window),
    openTime: window ? minutesToTime(window.openMinute) : null,
    closeTime: window ? minutesToTime(window.closeMinute) : null,
    starts: [],
    slots: [],
    busy: [],
    reason,
  });

  const window = dayWindow(settings, hours, date);
  if (!window) return empty('Closed');
  const today = toLocal(now, settings.timezone).date;
  if (date < today) return empty('This date has passed', window);
  if (date > addDays(today, settings.maxAdvanceDays)) return empty(`Bookings open ${settings.maxAdvanceDays} days ahead`, window);

  const [bookings, blocks] = await Promise.all([
    prisma.booking.findMany({
      where: { ...occupyingWhere(now), roomId, startsAt: { lt: window.closeAt }, endsAt: { gt: window.openAt } },
      select: { startsAt: true, endsAt: true },
    }),
    prisma.availabilityBlock.findMany({
      where: { OR: [{ roomId }, { roomId: null }], startsAt: { lt: window.closeAt }, endsAt: { gt: window.openAt } },
      select: { startsAt: true, endsAt: true },
    }),
  ]);
  type Busy = { s: number; e: number; kind: 'booking' | 'closure' };
  const busy: Busy[] = [
    ...bookings.map((b) => ({ s: b.startsAt.getTime(), e: b.endsAt.getTime(), kind: 'booking' as const })),
    ...blocks.map((b) => ({ s: b.startsAt.getTime(), e: b.endsAt.getTime(), kind: 'closure' as const })),
  ].sort((a, b) => a.s - b.s);

  // Every start time in opening hours is listed with its state, so the page can show
  // booked and closed times (greyed / red) as well as the free ones. No customer
  // details are ever included — only that a time is taken.
  const earliest = now.getTime() + settings.minNoticeMinutes * 60000;
  const starts: AvailabilityResponse['starts'] = [];
  const slots: AvailabilityResponse['slots'] = [];
  const step = settings.slotMinutes;
  const first = Math.ceil(window.openMinute / step) * step;
  for (let m = first; m < window.closeMinute; m += step) {
    const time = minutesToTime(m);
    const t = fromLocal(date, m, settings.timezone).getTime();
    const covering = busy.filter((b) => b.s <= t && t < b.e);
    if (covering.some((b) => b.kind === 'closure')) {
      slots.push({ time, state: 'closed', maxDurationMinutes: 0 });
      continue;
    }
    if (covering.length) {
      slots.push({ time, state: 'booked', maxDurationMinutes: 0 });
      continue;
    }
    if (t < earliest || (pw.earliestStart !== null && m < pw.earliestStart)) {
      slots.push({ time, state: 'unavailable', maxDurationMinutes: 0 });
      continue;
    }
    const nextBusy = busy.find((b) => b.s > t)?.s ?? Infinity;
    const limit = Math.min(window.closeAt.getTime(), nextBusy);
    let max = Math.min(Math.floor((limit - t) / 60000 / step) * step, maxLength);
    if (pw.latestEnd !== null) max = Math.min(max, pw.latestEnd - m);
    if (max >= minLength && m + minLength <= window.closeMinute) {
      starts.push({ time, maxDurationMinutes: max });
      slots.push({ time, state: 'available', maxDurationMinutes: max });
    } else {
      // Free, but too short a gap before the next booking / closing time.
      slots.push({ time, state: 'unavailable', maxDurationMinutes: 0 });
    }
  }

  return {
    date,
    roomId,
    open: true,
    openTime: minutesToTime(window.openMinute),
    closeTime: minutesToTime(window.closeMinute),
    starts,
    slots,
    busy: busy.map((b) => ({
      start: localTimeLabel(new Date(Math.max(b.s, window.openAt.getTime())), settings.timezone),
      end: b.e >= window.closeAt.getTime() ? minutesToTime(window.closeMinute) : localTimeLabel(new Date(b.e), settings.timezone),
      kind: b.kind,
    })),
    reason: starts.length ? null : 'Fully booked',
  };
}

export async function getEquipmentAvailability(startsAt: Date, endsAt: Date, excludeBookingId?: string): Promise<EquipmentAvailability[]> {
  const [items, usage] = await Promise.all([
    prisma.equipment.findMany({ where: { active: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    equipmentPeakUsage(prisma, startsAt, endsAt, excludeBookingId),
  ]);
  return items.map((i) => ({
    id: i.id,
    name: i.name,
    description: i.description,
    pricePence: i.pricePence,
    pricing: i.pricing,
    available: Math.max(0, i.quantity - (usage.get(i.id) ?? 0)),
  }));
}
