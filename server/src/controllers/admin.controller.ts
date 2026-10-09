import {
  adminBookingSchema,
  adminBookingUpdateSchema,
  blockSchema,
  bookingListQuerySchema,
  cancelBookingSchema,
  customerUpdateSchema,
  dateSchema,
  equipmentSchema,
  connectionsSchema,
  idParamSchema,
  idSchema,
  promoCodeSchema,
  openingHoursSchema,
  priceRuleSchema,
  recordPaymentSchema,
  refundSchema,
  roomSchema,
  settingsSchema,
  slotSchema,
  staffCreateSchema,
  staffUpdateSchema,
  testEmailSchema,
  timeSchema,
  type AuditEntryDto,
  type EmailMessageDto,
} from '@habitat/shared';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db/prisma';
import { actor } from '../middleware/auth';
import * as q from '../services/admin-queries.service';
import * as promos from '../services/promo.service';
import * as connections from '../services/connections.service';
import { assertAvailable, assertBookingRules, getEquipmentAvailability, resolveSlot } from '../services/availability.service';
import * as bookings from '../services/booking.service';
import * as catalogue from '../services/catalogue.service';
import { enqueueEmail, processOutbox, retryEmail } from '../services/email/outbox';
import { testEmail } from '../services/email/templates';
import { smtpConfigured, verifySmtp } from '../services/email/transport';
import { systemHealth } from '../services/health.service';
import * as payments from '../services/payment.service';
import { priceBooking } from '../services/pricing.service';
import { getOpeningHours, getSettings, openingHoursDto, setOpeningHours, updateSettings } from '../services/settings.service';
import * as staff from '../services/staff.service';
import { notFound } from '../utils/errors';
import { localTimeLabel } from '../utils/time';
import { parse } from '../utils/validate';

const id = (req: Request) => parse(idParamSchema, req.params).id;
const a = (req: Request) => actor(req);

export const adminController = {
  // --- Overview -------------------------------------------------------------------
  dashboard: async (_req: Request, res: Response) => res.json(await q.dashboard()),
  calendar: async (req: Request, res: Response) => {
    const { from, to } = parse(z.object({ from: dateSchema, to: dateSchema }), req.query);
    res.json(await q.calendar(from, to));
  },
  health: async (_req: Request, res: Response) => res.json(await systemHealth()),

  // --- Bookings ------------------------------------------------------------------
  listBookings: async (req: Request, res: Response) => res.json(await q.listBookings(parse(bookingListQuerySchema, req.query))),
  getBooking: async (req: Request, res: Response) => res.json(await q.bookingDetail(id(req))),

  /** Price + availability preview for the staff booking form (nothing is reserved). */
  quote: async (req: Request, res: Response) => {
    const input = parse(slotSchema.extend({ excludeBookingId: idSchema.optional(), ignoreBookingRules: z.boolean().default(false) }), req.body);
    const [settings, hours] = await Promise.all([getSettings(), getOpeningHours()]);
    const slot = resolveSlot(settings, input.date, input.startTime, input.durationMinutes);
    if (!input.ignoreBookingRules) assertBookingRules(settings, hours, slot, 'staff');
    const equipment = await assertAvailable(prisma, { ...input, startsAt: slot.startsAt, endsAt: slot.endsAt, allowInactiveEquipment: Boolean(input.excludeBookingId) });
    const { room, plan } = await bookings.roomAndPlan(prisma, input.roomId, input.ratePlanId, { requireActiveRoom: false });
    const priced = priceBooking({ room, ratePlan: plan, startsAt: slot.startsAt, endsAt: slot.endsAt, equipment, timezone: settings.timezone, currency: settings.currency });
    res.json({
      available: true,
      startsAt: slot.startsAt,
      endsAt: slot.endsAt,
      endTime: localTimeLabel(slot.endsAt, settings.timezone),
      lines: priced.lines,
      totalPence: priced.totalPence,
    });
  },
  equipmentAvailability: async (req: Request, res: Response) => {
    const input = parse(z.object({ date: dateSchema, startTime: timeSchema, durationMinutes: z.coerce.number().int().min(15).max(1440), excludeBookingId: idSchema.optional() }), req.query);
    const slot = resolveSlot(await getSettings(), input.date, input.startTime, input.durationMinutes);
    res.json(await getEquipmentAvailability(slot.startsAt, slot.endsAt, input.excludeBookingId));
  },
  createBooking: async (req: Request, res: Response) => {
    const { actorId, ip } = a(req);
    const b = await bookings.createAdminBooking(parse(adminBookingSchema, req.body), actorId, ip);
    res.status(201).json(await q.bookingDetail(b.id));
  },
  updateBooking: async (req: Request, res: Response) => {
    const { actorId, ip } = a(req);
    await bookings.updateBooking(id(req), parse(adminBookingUpdateSchema, req.body), actorId, ip);
    res.json(await q.bookingDetail(id(req)));
  },
  cancelBooking: async (req: Request, res: Response) => {
    const { actorId, ip } = a(req);
    const result = await bookings.cancelBooking(id(req), parse(cancelBookingSchema, req.body), { actorId, by: 'staff', ip });
    res.json({ booking: await q.bookingDetail(id(req)), refundedPence: result.refundedPence, refundErrors: result.refundErrors });
  },
  complete: async (req: Request, res: Response) => {
    const { actorId, ip } = a(req);
    await bookings.setOutcome(id(req), 'COMPLETED', actorId, ip);
    res.json(await q.bookingDetail(id(req)));
  },
  noShow: async (req: Request, res: Response) => {
    const { actorId, ip } = a(req);
    await bookings.setOutcome(id(req), 'NO_SHOW', actorId, ip);
    res.json(await q.bookingDetail(id(req)));
  },
  notes: async (req: Request, res: Response) => {
    const { internalNotes } = parse(z.object({ internalNotes: z.string().trim().max(2000).nullable() }), req.body);
    await bookings.updateInternalNotes(id(req), internalNotes || null, a(req).actorId);
    res.json(await q.bookingDetail(id(req)));
  },
  recordPayment: async (req: Request, res: Response) => {
    const { actorId, ip } = a(req);
    await payments.recordManualPayment(id(req), parse(recordPaymentSchema, req.body), actorId, ip);
    res.status(201).json(await q.bookingDetail(id(req)));
  },
  paymentLink: async (req: Request, res: Response) => {
    const { actorId, ip } = a(req);
    res.json(await bookings.sendPaymentLink(id(req), actorId, ip));
  },
  resendConfirmation: async (req: Request, res: Response) => {
    await bookings.resendConfirmation(id(req), a(req).actorId);
    res.status(204).end();
  },
  reconcile: async (req: Request, res: Response) => {
    const pending = await prisma.payment.findMany({ where: { bookingId: id(req), status: 'PENDING', method: 'STRIPE' } });
    const results = [];
    for (const p of pending) results.push(await payments.reconcilePayment(p.id));
    res.json({ results, booking: await q.bookingDetail(id(req)) });
  },
  refund: async (req: Request, res: Response) => {
    const { actorId, ip } = a(req);
    const input = parse(refundSchema, req.body);
    const p = await payments.refundPayment(id(req), input.amountPence, input.reason, actorId, ip);
    res.json(await q.bookingDetail(p.bookingId));
  },
  listPayments: async (_req: Request, res: Response) => res.json(await q.listPayments()),

  // --- Customers -----------------------------------------------------------------
  listCustomers: async (req: Request, res: Response) => {
    const { q: search } = parse(z.object({ q: z.string().trim().max(120).optional() }), req.query);
    res.json(await catalogue.listCustomers(search));
  },
  getCustomer: async (req: Request, res: Response) => res.json(await q.customerDetail(id(req))),
  updateCustomer: async (req: Request, res: Response) => {
    await catalogue.updateCustomer(id(req), parse(customerUpdateSchema, req.body), a(req));
    res.json(await q.customerDetail(id(req)));
  },

  // --- Rooms, pricing, equipment ---------------------------------------------------
  listPromoCodes: async (_req: Request, res: Response) => res.json(await promos.listPromoCodes()),
  createPromoCode: async (req: Request, res: Response) => res.status(201).json(await promos.createPromoCode(parse(promoCodeSchema, req.body), a(req))),
  updatePromoCode: async (req: Request, res: Response) => res.json(await promos.updatePromoCode(id(req), parse(promoCodeSchema, req.body), a(req))),
  deletePromoCode: async (req: Request, res: Response) => {
    await promos.deletePromoCode(id(req), a(req));
    res.status(204).end();
  },

  listRooms: async (_req: Request, res: Response) => res.json(await catalogue.listRooms()),
  createRoom: async (req: Request, res: Response) => res.status(201).json(await catalogue.createRoom(parse(roomSchema, req.body), a(req))),
  updateRoom: async (req: Request, res: Response) => res.json(await catalogue.updateRoom(id(req), parse(roomSchema, req.body), a(req))),
  deleteRoom: async (req: Request, res: Response) => {
    await catalogue.deleteRoom(id(req), a(req));
    res.status(204).end();
  },
  addPriceRule: async (req: Request, res: Response) => {
    await catalogue.addPriceRule(id(req), parse(priceRuleSchema, req.body), a(req));
    res.status(201).json((await catalogue.listRooms()).find((r) => r.id === id(req)));
  },
  deletePriceRule: async (req: Request, res: Response) => {
    const { ruleId } = parse(z.object({ id: idSchema, ruleId: idSchema }), req.params);
    await catalogue.deletePriceRule(id(req), ruleId, a(req));
    res.json((await catalogue.listRooms()).find((r) => r.id === id(req)));
  },
  listEquipment: async (_req: Request, res: Response) => res.json(await catalogue.listEquipment()),
  createEquipment: async (req: Request, res: Response) => res.status(201).json(await catalogue.createEquipment(parse(equipmentSchema, req.body), a(req))),
  updateEquipment: async (req: Request, res: Response) => res.json(await catalogue.updateEquipment(id(req), parse(equipmentSchema, req.body), a(req))),
  deleteEquipment: async (req: Request, res: Response) => {
    await catalogue.deleteEquipment(id(req), a(req));
    res.status(204).end();
  },

  // --- Hours, closures, settings -------------------------------------------------
  getHours: async (_req: Request, res: Response) => res.json(openingHoursDto(await getOpeningHours())),
  setHours: async (req: Request, res: Response) => {
    const { actorId, ip } = a(req);
    res.json(openingHoursDto(await setOpeningHours(parse(openingHoursSchema, req.body), actorId, ip)));
  },
  listBlocks: async (_req: Request, res: Response) => res.json(await catalogue.listBlocks()),
  createBlock: async (req: Request, res: Response) => res.status(201).json(await catalogue.createBlock(parse(blockSchema, req.body), a(req))),
  deleteBlock: async (req: Request, res: Response) => {
    await catalogue.deleteBlock(id(req), a(req));
    res.status(204).end();
  },
  getSettings: async (_req: Request, res: Response) => res.json(connections.generalSettings(await getSettings())),
  updateSettings: async (req: Request, res: Response) => {
    const { actorId, ip } = a(req);
    res.json(connections.generalSettings(await updateSettings(parse(settingsSchema, req.body), actorId, ip)));
  },
  getConnections: async (_req: Request, res: Response) => res.json(await connections.getConnections()),
  updateConnections: async (req: Request, res: Response) => {
    const { actorId, ip } = a(req);
    res.json(await connections.updateConnections(parse(connectionsSchema, req.body), actorId, ip));
  },
  testConnection: async (req: Request, res: Response) =>
    res.json(await connections.testConnection(parse(z.object({ service: z.enum(['stripe', 'apexbook']) }), req.body).service)),

  // --- Email -------------------------------------------------------------------------
  email: async (_req: Request, res: Response) => {
    const messages = await prisma.emailMessage.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
    const body: { configured: boolean; messages: EmailMessageDto[] } = {
      configured: smtpConfigured(),
      messages: messages.map((m) => ({
        id: m.id, kind: m.kind, to: m.to, subject: m.subject, status: m.status, attempts: m.attempts, lastError: m.lastError, bookingId: m.bookingId, createdAt: m.createdAt.toISOString(), sentAt: m.sentAt?.toISOString() ?? null,
      })),
    };
    res.json(body);
  },
  verifyEmail: async (_req: Request, res: Response) => res.json(await verifySmtp()),
  testEmail: async (req: Request, res: Response) => {
    const { to } = parse(testEmailSchema, req.body);
    const msg = await enqueueEmail(testEmail(to, await getSettings()));
    await processOutbox();
    res.json(await prisma.emailMessage.findUniqueOrThrow({ where: { id: msg.id } }));
  },
  retryEmail: async (req: Request, res: Response) => {
    await retryEmail(id(req));
    await processOutbox();
    res.status(204).end();
  },

  // --- Staff & audit -------------------------------------------------------------
  listStaff: async (_req: Request, res: Response) => res.json((await prisma.staffUser.findMany({ orderBy: { name: 'asc' } })).map(staff.toStaffDto)),
  inviteStaff: async (req: Request, res: Response) => {
    const { actorId, ip } = a(req);
    res.status(201).json(await staff.inviteStaff(parse(staffCreateSchema, req.body), actorId, ip));
  },
  updateStaff: async (req: Request, res: Response) => {
    const { actorId, ip } = a(req);
    res.json(await staff.updateStaff(id(req), parse(staffUpdateSchema, req.body), actorId, ip));
  },
  audit: async (_req: Request, res: Response) => {
    const rows = await prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 300, include: { actor: { select: { name: true } } } });
    const body: AuditEntryDto[] = rows.map((r) => ({ id: r.id, action: r.action, actor: r.actor?.name ?? null, targetType: r.targetType, targetId: r.targetId, metadata: r.metadata, createdAt: r.createdAt.toISOString() }));
    res.json(body);
  },
};
