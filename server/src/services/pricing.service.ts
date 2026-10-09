import { lengthDiscountFor, lengthDiscountsSchema, planPrice, ratePlansSchema, type LengthDiscount, type PriceLine, type RatePlan } from '@habitat/shared';
import type { Equipment, PriceRule, PromoCode, Room } from '@prisma/client';
import { badRequest } from '../utils/errors';
import { formatMoney } from '../utils/money';
import { toLocal } from '../utils/time';

/** Pricing resolution: the room's rate is evaluated per 15-minute segment. */
const SEGMENT_MINUTES = 15;

export interface PricedBooking {
  lines: PriceLine[];
  roomSubtotalPence: number;
  equipmentSubtotalPence: number;
  /** Longer-booking discount plus promo code (positive pence, already taken off totalPence). */
  discountPence: number;
  /** What the promo code took off (0 without one). */
  promoPence: number;
  totalPence: number;
  items: { equipmentId: string; name: string; quantity: number; pricing: Equipment['pricing']; unitPricePence: number; lineTotalPence: number }[];
  snapshot: {
    computedAt: string;
    timezone: string;
    currency: string;
    lines: PriceLine[];
    roomRates: { label: string; hourlyRatePence: number; minutes: number }[];
    ratePlan?: RatePlan;
    lengthDiscount?: LengthDiscount;
    promo?: { code: string; kind: PromoCode['kind']; value: number };
  };
}

/** A room's "cheaper for longer" tiers (stored as JSON; invalid data is treated as none). */
export function roomLengthDiscounts(room: Pick<Room, 'lengthDiscounts'>): LengthDiscount[] {
  const parsed = lengthDiscountsSchema.safeParse(room.lengthDiscounts ?? []);
  return parsed.success ? parsed.data : [];
}

/** A room's session types (stored as JSON; invalid data is treated as none). */
export function roomRatePlans(room: Pick<Room, 'ratePlans'>): RatePlan[] {
  const parsed = ratePlansSchema.safeParse(room.ratePlans ?? []);
  return parsed.success ? parsed.data : [];
}

/**
 * The plan a booking is priced on: the one asked for, or the room's first plan.
 * Rooms without plans are priced per hour (null).
 */
export function resolveRatePlan(room: Pick<Room, 'ratePlans' | 'name'>, ratePlanId: string | null | undefined): RatePlan | null {
  const plans = roomRatePlans(room);
  if (!plans.length) return null;
  if (!ratePlanId) return plans[0]!;
  const plan = plans.find((p) => p.id === ratePlanId);
  if (!plan) throw badRequest(`That session type isn't available for ${room.name}.`, { ratePlanId: 'Choose a session type' });
  return plan;
}

const hoursLabel = (minutes: number) => {
  const h = minutes / 60;
  return `${Number.isInteger(h) ? h : h.toFixed(2).replace(/0$/, '')} h`;
};

/**
 * Calculate the price of a booking. This is the only place prices are computed;
 * nothing the browser sends about price is ever used.
 * If price rules overlap, the earliest-created matching rule applies.
 */
export function priceBooking(args: {
  room: Room & { priceRules: PriceRule[] };
  startsAt: Date;
  endsAt: Date;
  equipment: { item: Equipment; quantity: number }[];
  timezone: string;
  currency: string;
  /** Session type (length-based price list). Null = hourly pricing with price rules. */
  ratePlan?: RatePlan | null;
  /** A promo code already checked as valid for this booking (promo.service). */
  promo?: Pick<PromoCode, 'code' | 'kind' | 'value'> | null;
}): PricedBooking {
  const { room, startsAt, endsAt, timezone, currency } = args;
  const rules = [...room.priceRules].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const totalMinutes = Math.round((endsAt.getTime() - startsAt.getTime()) / 60000);
  const lines: PriceLine[] = [];
  const roomRates: { label: string; hourlyRatePence: number; minutes: number }[] = [];

  if (args.ratePlan) {
    const amountPence = planPrice(args.ratePlan, totalMinutes);
    lines.push({ kind: 'room', description: `${room.name} — ${args.ratePlan.name}, ${hoursLabel(totalMinutes)}`, amountPence });
    roomRates.push({ label: args.ratePlan.name, hourlyRatePence: Math.round((amountPence / totalMinutes) * 60), minutes: totalMinutes });
  } else {
    // Accumulate minutes per applicable rate.
    const buckets = new Map<string, { label: string; hourlyRatePence: number; minutes: number }>();
    for (let t = startsAt.getTime(); t < endsAt.getTime(); t += SEGMENT_MINUTES * 60000) {
      const segment = Math.min(SEGMENT_MINUTES, (endsAt.getTime() - t) / 60000);
      const local = toLocal(new Date(t), timezone);
      const rule = rules.find((r) => r.daysOfWeek.includes(local.dayOfWeek) && local.minutes >= r.startMinute && local.minutes < r.endMinute);
      const label = rule?.label ?? 'Standard rate';
      const rate = rule?.hourlyRatePence ?? room.hourlyRatePence;
      const key = `${label}|${rate}`;
      const b = buckets.get(key) ?? { label, hourlyRatePence: rate, minutes: 0 };
      b.minutes += segment;
      buckets.set(key, b);
    }

    roomRates.push(...buckets.values());
    const multipleRates = roomRates.length > 1;
    for (const b of roomRates) {
      lines.push({
        kind: 'room',
        description: `${room.name} — ${hoursLabel(b.minutes)} at ${formatMoney(b.hourlyRatePence, currency)}/h${multipleRates || b.label !== 'Standard rate' ? ` (${b.label})` : ''}`,
        amountPence: Math.round((b.hourlyRatePence * b.minutes) / 60),
      });
    }
  }
  const roomSubtotalPence = lines.reduce((s, l) => s + l.amountPence, 0);

  const items = args.equipment.map(({ item, quantity }) => {
    const lineTotalPence =
      item.pricing === 'PER_HOUR' ? Math.round((item.pricePence * quantity * totalMinutes) / 60) : item.pricePence * quantity;
    return { equipmentId: item.id, name: item.name, quantity, pricing: item.pricing, unitPricePence: item.pricePence, lineTotalPence };
  });
  for (const i of items) {
    lines.push({
      kind: 'equipment',
      equipmentId: i.equipmentId,
      quantity: i.quantity,
      description: `${i.quantity} × ${i.name}${i.pricing === 'PER_HOUR' ? ` (${hoursLabel(totalMinutes)} at ${formatMoney(i.unitPricePence, currency)}/h each)` : ''}`,
      amountPence: i.lineTotalPence,
    });
  }
  const equipmentSubtotalPence = items.reduce((s, i) => s + i.lineTotalPence, 0);

  // Cheaper for longer (hourly pricing only: session types already price each length).
  const tier = args.ratePlan ? null : lengthDiscountFor(roomLengthDiscounts(room), totalMinutes);
  const lengthPence = tier ? Math.round((roomSubtotalPence * tier.percentOff) / 100) : 0;
  if (tier && lengthPence > 0) {
    lines.push({ kind: 'discount', description: `${tier.percentOff}% off bookings of ${hoursLabel(tier.fromMinutes)} or more`, amountPence: -lengthPence });
  }

  // Promo code: off the whole booking, after the longer-booking discount; never below zero.
  const beforePromo = roomSubtotalPence + equipmentSubtotalPence - lengthPence;
  const promoPence = args.promo ? Math.min(beforePromo, args.promo.kind === 'PERCENT' ? Math.round((beforePromo * args.promo.value) / 100) : args.promo.value) : 0;
  if (args.promo && promoPence > 0) {
    const what = args.promo.kind === 'PERCENT' ? `${args.promo.value}% off` : `${formatMoney(args.promo.value, currency)} off`;
    lines.push({ kind: 'discount', description: `Promo code ${args.promo.code} (${what})`, amountPence: -promoPence });
  }
  const discountPence = lengthPence + promoPence;
  const totalPence = roomSubtotalPence + equipmentSubtotalPence - discountPence;

  return {
    lines,
    roomSubtotalPence,
    equipmentSubtotalPence,
    discountPence,
    promoPence,
    totalPence,
    items,
    snapshot: {
      computedAt: new Date().toISOString(),
      timezone,
      currency,
      lines,
      roomRates,
      ...(args.ratePlan ? { ratePlan: args.ratePlan } : {}),
      ...(tier ? { lengthDiscount: tier } : {}),
      ...(args.promo ? { promo: { code: args.promo.code, kind: args.promo.kind, value: args.promo.value } } : {}),
    },
  };
}
