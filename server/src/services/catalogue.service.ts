import {
  minutesToTime,
  timeToMinutes,
  type blockSchema,
  type BlockDto,
  type customerUpdateSchema,
  type equipmentSchema,
  type EquipmentDto,
  type priceRuleSchema,
  type RoomDto,
  type roomSchema,
} from '@habitat/shared';
import type { AvailabilityBlock, Equipment, PriceRule, Room } from '@prisma/client';
import type { z } from 'zod';
import { prisma } from '../db/prisma';
import { badRequest, conflict, notFound } from '../utils/errors';
import { fromLocal } from '../utils/time';
import { audit } from './audit.service';
import { roomLengthDiscounts, roomRatePlans } from './pricing.service';
import { getSettings } from './settings.service';

type Actor = { actorId: string; ip: string | null };

// --- Rooms ---------------------------------------------------------------------

export const toRoomDto = (r: Room & { priceRules: PriceRule[] }): RoomDto => ({
  id: r.id,
  name: r.name,
  description: r.description,
  capacity: r.capacity,
  hourlyRatePence: r.hourlyRatePence,
  colour: r.colour,
  active: r.active,
  sortOrder: r.sortOrder,
  imageUrl: r.imageUrl,
  ratePlans: roomRatePlans(r),
  minDurationMinutes: r.minDurationMinutes,
  lengthDiscounts: roomLengthDiscounts(r),
  priceRules: [...r.priceRules]
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((p) => ({ id: p.id, label: p.label, daysOfWeek: p.daysOfWeek, startTime: minutesToTime(p.startMinute), endTime: minutesToTime(p.endMinute), hourlyRatePence: p.hourlyRatePence })),
});

export async function listRooms(activeOnly = false) {
  const rooms = await prisma.room.findMany({ where: activeOnly ? { active: true } : undefined, include: { priceRules: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
  return rooms.map(toRoomDto);
}

export async function createRoom(input: z.output<typeof roomSchema>, a: Actor) {
  const room = await prisma.room.create({ data: input, include: { priceRules: true } });
  await audit({ action: 'room.created', actorId: a.actorId, targetType: 'room', targetId: room.id, metadata: { name: room.name, hourlyRatePence: room.hourlyRatePence }, ipAddress: a.ip });
  return toRoomDto(room);
}

export async function updateRoom(id: string, input: z.output<typeof roomSchema>, a: Actor) {
  const before = await prisma.room.findUnique({ where: { id } });
  if (!before) throw notFound('Room not found.');
  const room = await prisma.room.update({ where: { id }, data: input, include: { priceRules: true } });
  await audit({ action: 'room.updated', actorId: a.actorId, targetType: 'room', targetId: id, metadata: { before: { name: before.name, hourlyRatePence: before.hourlyRatePence, active: before.active }, after: input }, ipAddress: a.ip });
  return toRoomDto(room);
}

export async function deleteRoom(id: string, a: Actor) {
  const count = await prisma.booking.count({ where: { roomId: id } });
  if (count) throw conflict('This room has booking history, so it cannot be deleted. Mark it inactive instead.');
  await prisma.room.delete({ where: { id } }).catch(() => {
    throw notFound('Room not found.');
  });
  await audit({ action: 'room.deleted', actorId: a.actorId, targetType: 'room', targetId: id, ipAddress: a.ip });
}

export async function addPriceRule(roomId: string, input: z.output<typeof priceRuleSchema>, a: Actor) {
  if (!(await prisma.room.findUnique({ where: { id: roomId } }))) throw notFound('Room not found.');
  const rule = await prisma.priceRule.create({
    data: { roomId, label: input.label, daysOfWeek: [...new Set(input.daysOfWeek)].sort(), startMinute: timeToMinutes(input.startTime), endMinute: timeToMinutes(input.endTime), hourlyRatePence: input.hourlyRatePence },
  });
  await audit({ action: 'price_rule.created', actorId: a.actorId, targetType: 'room', targetId: roomId, metadata: { ruleId: rule.id, ...input }, ipAddress: a.ip });
  return rule;
}

export async function deletePriceRule(roomId: string, ruleId: string, a: Actor) {
  const r = await prisma.priceRule.deleteMany({ where: { id: ruleId, roomId } });
  if (!r.count) throw notFound('Price rule not found.');
  await audit({ action: 'price_rule.deleted', actorId: a.actorId, targetType: 'room', targetId: roomId, metadata: { ruleId }, ipAddress: a.ip });
}

// --- Equipment ---------------------------------------------------------------------

export const toEquipmentDto = (e: Equipment): EquipmentDto => ({
  id: e.id, name: e.name, description: e.description, pricePence: e.pricePence, pricing: e.pricing, quantity: e.quantity, active: e.active, sortOrder: e.sortOrder,
});

export async function listEquipment() {
  return (await prisma.equipment.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] })).map(toEquipmentDto);
}

export async function createEquipment(input: z.output<typeof equipmentSchema>, a: Actor) {
  const e = await prisma.equipment.create({ data: input });
  await audit({ action: 'equipment.created', actorId: a.actorId, targetType: 'equipment', targetId: e.id, metadata: input, ipAddress: a.ip });
  return toEquipmentDto(e);
}

export async function updateEquipment(id: string, input: z.output<typeof equipmentSchema>, a: Actor) {
  const before = await prisma.equipment.findUnique({ where: { id } });
  if (!before) throw notFound('Equipment not found.');
  const e = await prisma.equipment.update({ where: { id }, data: input });
  await audit({ action: 'equipment.updated', actorId: a.actorId, targetType: 'equipment', targetId: id, metadata: { before: { quantity: before.quantity, pricePence: before.pricePence, active: before.active }, after: input }, ipAddress: a.ip });
  return toEquipmentDto(e);
}

export async function deleteEquipment(id: string, a: Actor) {
  if (await prisma.bookingEquipment.count({ where: { equipmentId: id } })) {
    throw conflict('This item appears on bookings, so it cannot be deleted. Mark it inactive instead.');
  }
  await prisma.equipment.delete({ where: { id } }).catch(() => {
    throw notFound('Equipment not found.');
  });
  await audit({ action: 'equipment.deleted', actorId: a.actorId, targetType: 'equipment', targetId: id, ipAddress: a.ip });
}

// --- Availability blocks (closures) --------------------------------------------------

export const toBlockDto = (b: AvailabilityBlock & { room: Room | null }): BlockDto => ({
  id: b.id, roomId: b.roomId, roomName: b.room?.name ?? null, startsAt: b.startsAt.toISOString(), endsAt: b.endsAt.toISOString(), reason: b.reason,
});

export async function listBlocks(fromDate = new Date(Date.now() - 7 * 86400_000)) {
  const blocks = await prisma.availabilityBlock.findMany({ where: { endsAt: { gte: fromDate } }, include: { room: true }, orderBy: { startsAt: 'asc' } });
  return blocks.map(toBlockDto);
}

/** Closing a period does not cancel bookings already in it; they are reported so staff can act. */
export async function createBlock(input: z.output<typeof blockSchema>, a: Actor) {
  const s = await getSettings();
  const startsAt = fromLocal(input.startDate, timeToMinutes(input.startTime), s.timezone);
  const endsAt = fromLocal(input.endDate, timeToMinutes(input.endTime), s.timezone);
  if (endsAt <= startsAt) throw badRequest('Some fields need attention.', { endTime: 'End must be after start' });
  if (input.roomId && !(await prisma.room.findUnique({ where: { id: input.roomId } }))) throw badRequest('Room not found.');
  const block = await prisma.availabilityBlock.create({ data: { roomId: input.roomId ?? null, startsAt, endsAt, reason: input.reason, createdById: a.actorId }, include: { room: true } });
  const affected = await prisma.booking.findMany({
    where: { status: { in: ['CONFIRMED', 'PENDING_PAYMENT'] }, startsAt: { lt: endsAt }, endsAt: { gt: startsAt }, ...(input.roomId ? { roomId: input.roomId } : {}) },
    select: { id: true, reference: true },
  });
  await audit({ action: 'availability.blocked', actorId: a.actorId, targetType: 'block', targetId: block.id, metadata: { roomId: input.roomId, startsAt, endsAt, reason: input.reason }, ipAddress: a.ip });
  return { block: toBlockDto(block), affectedBookings: affected };
}

export async function deleteBlock(id: string, a: Actor) {
  const r = await prisma.availabilityBlock.deleteMany({ where: { id } });
  if (!r.count) throw notFound('Closure not found.');
  await audit({ action: 'availability.unblocked', actorId: a.actorId, targetType: 'block', targetId: id, ipAddress: a.ip });
}

// --- Customers ---------------------------------------------------------------------

export async function listCustomers(q?: string) {
  const customers = await prisma.customer.findMany({
    where: q
      ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }, { bandName: { contains: q, mode: 'insensitive' } }, { phone: { contains: q } }] }
      : undefined,
    include: { _count: { select: { bookings: true } }, bookings: { orderBy: { startsAt: 'desc' }, take: 1, select: { startsAt: true } } },
    orderBy: { name: 'asc' },
    take: 500,
  });
  return customers.map((c) => ({
    id: c.id, name: c.name, email: c.email, phone: c.phone, bandName: c.bandName, notes: c.notes,
    bookingCount: c._count.bookings, lastBookingAt: c.bookings[0]?.startsAt.toISOString() ?? null, createdAt: c.createdAt.toISOString(),
  }));
}

export async function updateCustomer(id: string, input: z.output<typeof customerUpdateSchema>, a: Actor) {
  const existing = await prisma.customer.findUnique({ where: { id } });
  if (!existing) throw notFound('Customer not found.');
  if (input.email !== existing.email && (await prisma.customer.findUnique({ where: { email: input.email } }))) {
    throw conflict('Another customer already uses that email address.');
  }
  const c = await prisma.customer.update({ where: { id }, data: input });
  await audit({ action: 'customer.updated', actorId: a.actorId, targetType: 'customer', targetId: id, metadata: { fields: Object.keys(input) }, ipAddress: a.ip });
  return c;
}
