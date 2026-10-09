import { describe, expect, it } from 'vitest';
import type { Equipment, PriceRule, Room } from '@prisma/client';
import { planDurations, planPrice, type RatePlan } from '@habitat/shared';
import { priceBooking } from '../src/services/pricing.service';
import { fromLocal, localTimeLabel, toLocal } from '../src/utils/time';

const TZ = 'Europe/London';

describe('timezone conversion (Europe/London)', () => {
  it('handles GMT and BST', () => {
    expect(fromLocal('2026-01-15', 18 * 60, TZ).toISOString()).toBe('2026-01-15T18:00:00.000Z');
    expect(fromLocal('2026-07-15', 18 * 60, TZ).toISOString()).toBe('2026-07-15T17:00:00.000Z');
    expect(localTimeLabel(new Date('2026-07-15T17:00:00Z'), TZ)).toBe('18:00');
  });

  it('handles the spring-forward and fall-back days', () => {
    // 29 March 2026: clocks go 01:00 → 02:00. 10:00 local is BST.
    expect(fromLocal('2026-03-29', 10 * 60, TZ).toISOString()).toBe('2026-03-29T09:00:00.000Z');
    expect(fromLocal('2026-03-29', 0, TZ).toISOString()).toBe('2026-03-29T00:00:00.000Z');
    // 25 October 2026: clocks go 02:00 → 01:00.
    expect(fromLocal('2026-10-25', 10 * 60, TZ).toISOString()).toBe('2026-10-25T10:00:00.000Z');
    expect(fromLocal('2026-10-25', 24 * 60, TZ).toISOString()).toBe('2026-10-26T00:00:00.000Z');
  });

  it('reports local date, minutes and weekday', () => {
    expect(toLocal(new Date('2026-07-18T22:30:00Z'), TZ)).toEqual({ date: '2026-07-18', minutes: 23 * 60 + 30, dayOfWeek: 6 });
    expect(toLocal(new Date('2026-07-18T23:30:00Z'), TZ).date).toBe('2026-07-19');
  });
});

const room = (rules: Partial<PriceRule>[] = []): Room & { priceRules: PriceRule[] } => ({
  id: 'r1', name: 'Room A', description: null, imageUrl: null, ratePlans: [],
  minDurationMinutes: null,
  lengthDiscounts: [], capacity: null, hourlyRatePence: 1500, colour: '#000000', active: true, sortOrder: 0, createdAt: new Date(), updatedAt: new Date(),
  priceRules: rules.map((r, i) => ({ id: `p${i}`, roomId: 'r1', label: 'Rule', daysOfWeek: [0, 1, 2, 3, 4, 5, 6], startMinute: 0, endMinute: 1440, hourlyRatePence: 0, createdAt: new Date(2026, 0, 1 + i), ...r }) as PriceRule),
});
const item = (over: Partial<Equipment>): Equipment => ({ id: 'e1', name: 'Mic', description: null, pricePence: 300, pricing: 'PER_BOOKING', quantity: 4, active: true, sortOrder: 0, createdAt: new Date(), updatedAt: new Date(), ...over });

describe('pricing (server-side only)', () => {
  const at = (iso: string) => new Date(iso);

  it('charges the base rate for plain hours', () => {
    const p = priceBooking({ room: room(), startsAt: at('2026-01-14T10:00:00Z'), endsAt: at('2026-01-14T12:00:00Z'), equipment: [], timezone: TZ, currency: 'gbp' });
    expect(p.totalPence).toBe(3000);
    expect(p.lines).toHaveLength(1);
  });

  it('splits a booking across a peak rule boundary using local time', () => {
    // Wednesday 14 Jan 2026 17:00–19:00 GMT; evening rate from 18:00.
    const r = room([{ label: 'Evening', daysOfWeek: [3], startMinute: 18 * 60, endMinute: 24 * 60, hourlyRatePence: 2000 }]);
    const p = priceBooking({ room: r, startsAt: at('2026-01-14T17:00:00Z'), endsAt: at('2026-01-14T19:00:00Z'), equipment: [], timezone: TZ, currency: 'gbp' });
    expect(p.roomSubtotalPence).toBe(1500 + 2000);
    expect(p.lines.map((l) => l.description).join(' | ')).toContain('Evening');
  });

  it('applies rules in local time during BST', () => {
    // Wednesday 15 July 2026 18:00–19:00 BST = 17:00–18:00 UTC → evening rate.
    const r = room([{ label: 'Evening', daysOfWeek: [3], startMinute: 18 * 60, endMinute: 24 * 60, hourlyRatePence: 2000 }]);
    const p = priceBooking({ room: r, startsAt: at('2026-07-15T17:00:00Z'), endsAt: at('2026-07-15T18:00:00Z'), equipment: [], timezone: TZ, currency: 'gbp' });
    expect(p.totalPence).toBe(2000);
  });

  it('prices equipment per booking and per hour', () => {
    const p = priceBooking({
      room: room(),
      startsAt: at('2026-01-14T10:00:00Z'),
      endsAt: at('2026-01-14T13:00:00Z'),
      equipment: [
        { item: item({ id: 'mic', pricePence: 300, pricing: 'PER_BOOKING' }), quantity: 2 },
        { item: item({ id: 'amp', name: 'Amp', pricePence: 250, pricing: 'PER_HOUR' }), quantity: 1 },
      ],
      timezone: TZ,
      currency: 'gbp',
    });
    expect(p.roomSubtotalPence).toBe(4500);
    expect(p.equipmentSubtotalPence).toBe(600 + 750);
    expect(p.totalPence).toBe(4500 + 1350);
    // Every line is included in the snapshot and the lines add up to the total.
    expect(p.snapshot.lines.reduce((s, l) => s + l.amountPence, 0)).toBe(p.totalPence);
  });
});

describe('session-length pricing (rate plans)', () => {
  const band: RatePlan = {
    id: 'band', name: 'Band rehearsal', description: null, extraHourPence: 1030, minDurationMinutes: null, maxDurationMinutes: null, earliestStartTime: null, latestEndTime: null,
    prices: [{ minutes: 120, pricePence: 2900 }, { minutes: 180, pricePence: 3675 }, { minutes: 240, pricePence: 4360 }],
  };
  const solo: RatePlan = { ...band, id: 'solo', name: 'Solo', prices: [], extraHourPence: 1100, minDurationMinutes: 60, latestEndTime: '18:00' };
  const rules = { slotMinutes: 60, minDurationMinutes: 120, maxDurationMinutes: 600 };

  it('uses the listed price for listed lengths and extra hours beyond', () => {
    expect(planPrice(band, 120)).toBe(2900);
    expect(planPrice(band, 240)).toBe(4360);
    expect(planPrice(band, 300)).toBe(4360 + 1030);
    expect(planPrice(solo, 180)).toBe(3300);
  });

  it('lists the lengths a customer can choose', () => {
    expect(planDurations(band, rules)).toEqual([120, 180, 240, 300, 360, 420, 480, 540, 600]);
    expect(planDurations(solo, rules)).toEqual([60, 120, 180, 240, 300, 360, 420, 480, 540, 600]);
    expect(planDurations({ ...band, extraHourPence: null }, rules)).toEqual([120, 180, 240]);
  });

  it('prices a booking on its plan, ignoring hourly rules, and snapshots the plan', () => {
    const r = room([{ label: 'Evening', hourlyRatePence: 9999 }]);
    const p = priceBooking({ room: r, ratePlan: band, startsAt: new Date('2026-01-14T18:00:00Z'), endsAt: new Date('2026-01-14T21:00:00Z'), equipment: [], timezone: TZ, currency: 'gbp' });
    expect(p.roomSubtotalPence).toBe(3675);
    expect(p.lines[0]!.description).toContain('Band rehearsal');
    expect(p.snapshot.ratePlan?.id).toBe('band');
  });
});
