import type { z } from 'zod';
import type { ratePlanSchema } from './schemas';
import { timeToMinutes } from './schemas';

export type RatePlan = z.output<typeof ratePlanSchema>;

interface DurationRules {
  slotMinutes: number;
  minDurationMinutes: number;
  maxDurationMinutes: number;
}

/** The session lengths a customer can pick for a plan, shortest first. */
export function planDurations(plan: RatePlan, s: DurationRules): number[] {
  const min = plan.minDurationMinutes ?? null;
  const max = plan.maxDurationMinutes ?? s.maxDurationMinutes;
  const listed = plan.prices.map((p) => p.minutes).filter((m) => m <= max && (min === null || m >= min));
  const out = new Set(listed);
  if (plan.extraHourPence !== null) {
    const longest = plan.prices.length ? Math.max(...plan.prices.map((p) => p.minutes)) : null;
    const from = longest !== null ? longest + s.slotMinutes : (min ?? s.minDurationMinutes);
    for (let m = from; m <= max; m += s.slotMinutes) if (m % s.slotMinutes === 0) out.add(m);
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * Price of a session of `minutes` on a plan. Listed lengths use their price; longer
 * sessions add extraHourPence per hour past the longest listed length. Lengths between
 * listed ones (staff bookings only) are charged pro rata from the nearest shorter one.
 */
export function planPrice(plan: RatePlan, minutes: number): number {
  const exact = plan.prices.find((p) => p.minutes === minutes);
  if (exact) return exact.pricePence;
  const sorted = [...plan.prices].sort((a, b) => a.minutes - b.minutes);
  const base = [...sorted].reverse().find((p) => p.minutes < minutes);
  if (base) {
    const rate = plan.extraHourPence ?? (base.pricePence / base.minutes) * 60;
    return Math.round(base.pricePence + (rate * (minutes - base.minutes)) / 60);
  }
  const first = sorted[0];
  const rate = plan.extraHourPence ?? (first ? (first.pricePence / first.minutes) * 60 : 0);
  return Math.round((rate * minutes) / 60);
}

/** Local-time window a plan can be booked in, as minutes from midnight. */
export function planWindow(plan: RatePlan) {
  return {
    earliestStart: plan.earliestStartTime ? timeToMinutes(plan.earliestStartTime) : null,
    latestEnd: plan.latestEndTime ? timeToMinutes(plan.latestEndTime) : null,
  };
}

/** The best "cheaper for longer" tier a booking of `minutes` qualifies for (null = none). */
export function lengthDiscountFor(discounts: { fromMinutes: number; percentOff: number }[], minutes: number) {
  const eligible = discounts.filter((d) => minutes >= d.fromMinutes);
  if (!eligible.length) return null;
  return eligible.reduce((best, d) => (d.percentOff > best.percentOff ? d : best));
}
