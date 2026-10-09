import {
  availabilityQuerySchema,
  manageTokenQuerySchema,
  publicBookingSchema,
  slotSchema,
  timeSchema,
  dateSchema,
  type PublicConfig,
  type PublicEquipment,
  type PublicRoom,
} from '@habitat/shared';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db/prisma';
import { getDayAvailability, getEquipmentAvailability, resolveSlot } from '../services/availability.service';
import * as bookings from '../services/booking.service';
import { toRoomDto } from '../services/catalogue.service';
import { getOpeningHours, getSettings, openingHoursDto } from '../services/settings.service';
import { toLocal } from '../utils/time';
import { parse } from '../utils/validate';

// Any prefix (it's configurable, and older bookings keep theirs, e.g. HAB-).
const refParam = z.object({ reference: z.string().regex(/^[A-Z]{2,5}-[A-Z0-9]{6}$/, 'Invalid reference') });
const viewQuery = z.object({ token: z.string().max(200).optional(), session_id: z.string().max(200).optional() });
const equipmentQuery = z.object({ date: dateSchema, startTime: timeSchema, durationMinutes: z.coerce.number().int().min(15).max(1440) });

export const publicController = {
  async config(_req: Request, res: Response) {
    const [s, hours] = await Promise.all([getSettings(), getOpeningHours()]);
    const body: PublicConfig = {
      businessName: s.businessName,
      timezone: s.timezone,
      currency: s.currency,
      contactEmail: s.contactEmail,
      contactPhone: s.contactPhone,
      address: s.address,
      websiteUrl: s.websiteUrl,
      slotMinutes: s.slotMinutes,
      minDurationMinutes: s.minDurationMinutes,
      maxDurationMinutes: s.maxDurationMinutes,
      maxAdvanceDays: s.maxAdvanceDays,
      today: toLocal(new Date(), s.timezone).date,
      onlineBooking: bookings.onlineBookingAvailability(s),
      cancellationPolicy: s.cancellationPolicy,
      bookingTerms: s.bookingTerms,
      homeHeadline: s.homeHeadline,
      homeIntro: s.homeIntro,
      announcement: s.announcement,
      tagline: s.tagline,
      aboutText: s.aboutText,
      roomsIntro: s.roomsIntro,
      communalText: s.communalText,
      privacyPolicy: s.privacyPolicy,
      featuredQuote: s.featuredQuote,
      featuredQuoteAuthor: s.featuredQuoteAuthor,
      instagramUrl: s.instagramUrl,
      facebookUrl: s.facebookUrl,
      openingHours: openingHoursDto(hours),
    };
    res.set('Cache-Control', 'no-cache').json(body);
  },

  async rooms(_req: Request, res: Response) {
    const settings = await getSettings();
    const rooms = await prisma.room.findMany({ where: { active: true }, include: { priceRules: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
    const body: PublicRoom[] = rooms.map((r) => {
      const dto = toRoomDto(r);
      return {
        id: dto.id,
        name: dto.name,
        description: dto.description,
        capacity: dto.capacity,
        hourlyRatePence: dto.hourlyRatePence,
        fromRatePence: Math.min(dto.hourlyRatePence, ...dto.priceRules.map((p) => p.hourlyRatePence)),
        imageUrl: dto.imageUrl,
        ratePlans: dto.ratePlans,
        priceRules: dto.priceRules.map(({ id: _id, ...p }) => p),
        minDurationMinutes: Math.max(dto.minDurationMinutes ?? settings.minDurationMinutes, settings.slotMinutes),
        lengthDiscounts: dto.lengthDiscounts,
      };
    });
    res.json(body);
  },

  async equipmentList(_req: Request, res: Response) {
    const items = await prisma.equipment.findMany({ where: { active: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
    const body: PublicEquipment[] = items.map((i) => ({ id: i.id, name: i.name, description: i.description, pricePence: i.pricePence, pricing: i.pricing }));
    res.json(body);
  },

  async availability(req: Request, res: Response) {
    const q = parse(availabilityQuerySchema, req.query);
    res.json(await getDayAvailability(q.roomId, q.date, new Date(), q.ratePlanId));
  },

  async equipment(req: Request, res: Response) {
    const q = parse(equipmentQuery, req.query);
    const slot = resolveSlot(await getSettings(), q.date, q.startTime, q.durationMinutes);
    res.json(await getEquipmentAvailability(slot.startsAt, slot.endsAt));
  },

  async quote(req: Request, res: Response) {
    res.json(await bookings.quote(parse(slotSchema, req.body)));
  },

  async createBooking(req: Request, res: Response) {
    const input = parse(publicBookingSchema, req.body);
    res.status(201).json(await bookings.createOnlineBooking(input, req.ip ?? null));
  },

  async viewBooking(req: Request, res: Response) {
    const { reference } = parse(refParam, req.params);
    const q = parse(viewQuery, req.query);
    res.set('Cache-Control', 'no-store').json(await bookings.getPublicBooking(reference, { token: q.token, sessionId: q.session_id }));
  },

  async cancelBooking(req: Request, res: Response) {
    const { reference } = parse(refParam, req.params);
    const { token } = parse(manageTokenQuerySchema, req.body);
    res.json(await bookings.customerCancel(reference, token, req.ip ?? null));
  },
};
