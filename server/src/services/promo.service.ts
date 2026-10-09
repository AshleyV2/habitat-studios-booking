import type { PromoCodeDto, promoCodeSchema } from '@habitat/shared';
import type { PromoCode } from '@prisma/client';
import type { z } from 'zod';
import { prisma, type Tx } from '../db/prisma';
import { formatMoney } from '../utils/money';
import { badRequest, conflict, notFound } from '../utils/errors';
import { toLocal } from '../utils/time';
import { audit } from './audit.service';

/*
 * Promo codes customers enter when booking online. A code is only ever checked here, on the
 * server, against the booking it's being used on: dates (in the studio's timezone), rooms,
 * minimum spend and length, total uses and one use per customer.
 */

type Db = Tx | typeof prisma;
type Actor = { actorId: string; ip: string | null };

/** Bookings that count as having used a code: live or kept ones, and holds still waiting for payment. */
const usedWhere = (now: Date) => ({
  OR: [{ status: { in: ['CONFIRMED', 'COMPLETED', 'NO_SHOW'] as ('CONFIRMED' | 'COMPLETED' | 'NO_SHOW')[] } }, { status: 'PENDING_PAYMENT' as const, expiresAt: { gt: now } }],
});

export interface PromoContext {
  roomId: string;
  durationMinutes: number;
  /** Price before the code (after any longer-booking discount). */
  subtotalPence: number;
  currency: string;
  timezone: string;
  /** Known when booking; not when just quoting. */
  customerEmail?: string | null;
  now?: Date;
}

const invalid = (message: string) => badRequest(message, { promoCode: message });

/** The code if it can be used on this booking; otherwise a 400 saying why. */
export async function checkPromo(db: Db, rawCode: string, ctx: PromoContext): Promise<PromoCode> {
  const code = rawCode.trim().toUpperCase();
  const now = ctx.now ?? new Date();
  const promo = await db.promoCode.findUnique({ where: { code } });
  if (!promo || !promo.active) throw invalid(`“${code}” isn’t a valid promo code.`);
  const today = toLocal(now, ctx.timezone).date;
  if (promo.validFrom && today < promo.validFrom) throw invalid(`${code} can be used from ${promo.validFrom}.`);
  if (promo.validUntil && today > promo.validUntil) throw invalid(`${code} has expired.`);
  if (promo.roomIds.length && !promo.roomIds.includes(ctx.roomId)) throw invalid(`${code} can’t be used for this room.`);
  if (promo.minDurationMinutes && ctx.durationMinutes < promo.minDurationMinutes) {
    throw invalid(`${code} is for bookings of ${promo.minDurationMinutes / 60} hours or more.`);
  }
  if (promo.minSpendPence && ctx.subtotalPence < promo.minSpendPence) {
    throw invalid(`${code} is for bookings of ${formatMoney(promo.minSpendPence, ctx.currency)} or more.`);
  }
  if (promo.maxUses !== null) {
    const used = await db.booking.count({ where: { promoCodeId: promo.id, ...usedWhere(now) } });
    if (used >= promo.maxUses) throw invalid(`${code} has been fully used.`);
  }
  if (promo.onePerCustomer && ctx.customerEmail) {
    const mine = await db.booking.count({ where: { promoCodeId: promo.id, customerEmail: { equals: ctx.customerEmail, mode: 'insensitive' }, ...usedWhere(now) } });
    if (mine > 0) throw invalid(`You’ve already used ${code}.`);
  }
  return promo;
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

function toDto(p: PromoCode, uses: number): PromoCodeDto {
  return {
    id: p.id,
    code: p.code,
    description: p.description,
    kind: p.kind,
    value: p.value,
    active: p.active,
    validFrom: p.validFrom,
    validUntil: p.validUntil,
    maxUses: p.maxUses,
    onePerCustomer: p.onePerCustomer,
    roomIds: p.roomIds,
    minSpendPence: p.minSpendPence,
    minDurationMinutes: p.minDurationMinutes,
    uses,
    createdAt: p.createdAt.toISOString(),
  };
}

export async function listPromoCodes() {
  const now = new Date();
  const [codes, counts] = await Promise.all([
    prisma.promoCode.findMany({ orderBy: [{ active: 'desc' }, { createdAt: 'desc' }] }),
    prisma.booking.groupBy({ by: ['promoCodeId'], where: { promoCodeId: { not: null }, ...usedWhere(now) }, _count: { _all: true } }),
  ]);
  const uses = new Map(counts.map((c) => [c.promoCodeId, c._count._all]));
  return codes.map((p) => toDto(p, uses.get(p.id) ?? 0));
}

async function assertRooms(roomIds: string[]) {
  if (!roomIds.length) return;
  const found = await prisma.room.count({ where: { id: { in: roomIds } } });
  if (found !== new Set(roomIds).size) throw badRequest('Choose rooms from the list.', { roomIds: 'Choose rooms from the list' });
}

export async function createPromoCode(input: z.output<typeof promoCodeSchema>, a: Actor) {
  await assertRooms(input.roomIds);
  if (await prisma.promoCode.findUnique({ where: { code: input.code } })) throw conflict(`There’s already a code called ${input.code}.`);
  const p = await prisma.promoCode.create({ data: { ...input, roomIds: [...new Set(input.roomIds)] } });
  await audit({ action: 'promo.created', actorId: a.actorId, targetType: 'promo_code', targetId: p.id, metadata: { code: p.code, kind: p.kind, value: p.value }, ipAddress: a.ip });
  return toDto(p, 0);
}

export async function updatePromoCode(id: string, input: z.output<typeof promoCodeSchema>, a: Actor) {
  const before = await prisma.promoCode.findUnique({ where: { id } });
  if (!before) throw notFound('Promo code not found.');
  await assertRooms(input.roomIds);
  if (input.code !== before.code && (await prisma.promoCode.findUnique({ where: { code: input.code } }))) throw conflict(`There’s already a code called ${input.code}.`);
  const p = await prisma.promoCode.update({ where: { id }, data: { ...input, roomIds: [...new Set(input.roomIds)] } });
  await audit({ action: 'promo.updated', actorId: a.actorId, targetType: 'promo_code', targetId: id, metadata: { code: p.code, active: p.active }, ipAddress: a.ip });
  const uses = await prisma.booking.count({ where: { promoCodeId: id, ...usedWhere(new Date()) } });
  return toDto(p, uses);
}

/** Delete a code. Bookings that used it keep the code as typed (promoCode), so history isn't lost. */
export async function deletePromoCode(id: string, a: Actor) {
  const p = await prisma.promoCode.findUnique({ where: { id } });
  if (!p) throw notFound('Promo code not found.');
  await prisma.promoCode.delete({ where: { id } });
  await audit({ action: 'promo.deleted', actorId: a.actorId, targetType: 'promo_code', targetId: id, metadata: { code: p.code }, ipAddress: a.ip });
}
