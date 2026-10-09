import { minutesToTime, SETUP_FILE_FORMAT, siteDocSchema, timeToMinutes, type SetupFile } from '@habitat/shared';
import type { Prisma } from '@prisma/client';
import { applyIntegrations } from '../config/integrations';
import { env } from '../config/env';
import { prisma } from '../db/prisma';
import { badRequest } from '../utils/errors';
import { audit } from './audit.service';
import { appVersion } from './health.service';
import { getOpeningHours, getSettings } from './settings.service';
import { sniffImage } from './site.service';

/*
 * Setup transfer: everything that makes up a site's setup, as one file, so it can be loaded
 * into another installation (e.g. a cloud site moving onto the studio's own server).
 *
 * Included: business and booking settings, website texts, opening hours, rooms with prices,
 * equipment, promo codes, upcoming closures, and the website (builder pages and photos).
 * Not included: bookings, customers, payments, staff logins, and secrets (Stripe keys, the
 * email password, the ApexBook monitoring key). Secrets are encrypted per installation and
 * are entered again on the new one. A full move with bookings uses a database backup instead.
 */

const SETTINGS_KEYS = [
  'businessName', 'timezone', 'contactEmail', 'contactPhone', 'address', 'websiteUrl', 'slotMinutes', 'minDurationMinutes', 'maxDurationMinutes',
  'minNoticeMinutes', 'maxAdvanceDays', 'holdMinutes', 'onlineBookingEnabled', 'allowCustomerCancellation', 'cancellationNoticeHours',
  'cancellationPolicy', 'bookingTerms', 'confirmationMessage', 'adminNotifyEmail', 'notifyOnNewBooking', 'notifyOnCancellation', 'homeHeadline',
  'homeIntro', 'announcement', 'tagline', 'aboutText', 'roomsIntro', 'communalText', 'privacyPolicy', 'featuredQuote', 'featuredQuoteAuthor',
  'instagramUrl', 'facebookUrl',
] as const;
const EMAIL_KEYS = ['smtpHost', 'smtpPort', 'smtpSecurity', 'smtpUser', 'emailFromName', 'emailFromAddress', 'emailReplyTo'] as const;
const MAX_DOC_BYTES = 900_000;
const MAX_ASSET_BYTES = 5 * 1024 * 1024;

const pick = <T extends object, K extends keyof T>(o: T, keys: readonly K[]) => Object.fromEntries(keys.map((k) => [k, o[k]])) as Pick<T, K>;

/** The setup file, with the website's photos included (base64). */
export async function exportSetup(actorId: string, ip: string | null) {
  const now = new Date();
  const [settings, hours, rooms, equipment, promos, closures, draft, published, assets] = await Promise.all([
    getSettings(),
    getOpeningHours(),
    prisma.room.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], include: { priceRules: { orderBy: { createdAt: 'asc' } } } }),
    prisma.equipment.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    prisma.promoCode.findMany({ orderBy: { code: 'asc' } }),
    prisma.availabilityBlock.findMany({ where: { endsAt: { gt: now } }, orderBy: { startsAt: 'asc' } }),
    prisma.siteDraft.findUnique({ where: { id: 1 } }),
    prisma.siteVersion.findFirst({ orderBy: { publishedAt: 'desc' } }),
    prisma.siteAsset.findMany({ orderBy: { createdAt: 'asc' } }),
  ]);
  const file = {
    format: SETUP_FILE_FORMAT,
    version: 1,
    exportedAt: now.toISOString(),
    from: { businessName: settings.businessName, publicUrl: env.PUBLIC_URL, version: appVersion() },
    settings: pick(settings, SETTINGS_KEYS),
    currency: settings.currency,
    bookingRefPrefix: settings.bookingRefPrefix,
    email: pick(settings, EMAIL_KEYS),
    openingHours: hours.map((h) => ({ dayOfWeek: h.dayOfWeek, isOpen: h.isOpen, openTime: minutesToTime(h.openMinute), closeTime: minutesToTime(h.closeMinute) })),
    rooms: rooms.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      imageUrl: r.imageUrl,
      ratePlans: r.ratePlans,
      capacity: r.capacity,
      hourlyRatePence: r.hourlyRatePence,
      minDurationMinutes: r.minDurationMinutes,
      lengthDiscounts: r.lengthDiscounts,
      colour: r.colour,
      active: r.active,
      sortOrder: r.sortOrder,
      priceRules: r.priceRules.map((p) => ({ label: p.label, daysOfWeek: p.daysOfWeek, startTime: minutesToTime(p.startMinute), endTime: minutesToTime(p.endMinute), hourlyRatePence: p.hourlyRatePence })),
    })),
    equipment: equipment.map((e) => pick(e, ['id', 'name', 'description', 'pricePence', 'pricing', 'quantity', 'active', 'sortOrder'])),
    promoCodes: promos.map((p) =>
      pick(p, ['code', 'description', 'kind', 'value', 'active', 'validFrom', 'validUntil', 'maxUses', 'onePerCustomer', 'roomIds', 'minSpendPence', 'minDurationMinutes']),
    ),
    closures: closures.map((b) => ({ roomId: b.roomId, startsAt: b.startsAt.toISOString(), endsAt: b.endsAt.toISOString(), reason: b.reason })),
    website: {
      builderLive: draft?.builderLive ?? false,
      draft: draft?.doc ?? null,
      published: published?.doc ?? null,
      assets: assets.map((a) => ({ id: a.id, filename: a.filename, mime: a.mime, size: a.size, data: Buffer.from(a.data).toString('base64') })),
    },
  };
  await audit({ action: 'settings.exported', actorId, targetType: 'settings', metadata: { rooms: rooms.length, photos: assets.length }, ipAddress: ip });
  return file;
}

/** One website photo from a setup file, stored under the same id so the website's links keep working. */
export async function importAsset(id: string, body: unknown, filename: string, actorId: string) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw badRequest('Invalid photo id.');
  if (!Buffer.isBuffer(body) || body.length === 0) throw badRequest('No photo received.');
  if (body.length > MAX_ASSET_BYTES) throw badRequest('That photo is larger than 5 MB.');
  const mime = sniffImage(body);
  if (!mime) throw badRequest('That file is not a JPEG, PNG, GIF or WebP image.');
  const clean = filename.replace(/[^\w.\- ]+/g, '').slice(0, 200) || 'image';
  const data = { filename: clean, mime, size: body.length, data: new Uint8Array(body), uploadedById: actorId };
  await prisma.siteAsset.upsert({ where: { id }, create: { id, ...data }, update: data });
  return { id };
}

function checkSiteDoc(doc: unknown, which: string) {
  if (doc === null) return null;
  if (!doc || typeof doc !== 'object' || (doc as { v?: unknown }).v !== 1 || !Array.isArray((doc as { pages?: unknown }).pages)) {
    throw badRequest(`The website ${which} in this file is not a website document.`);
  }
  if (JSON.stringify(doc).length > MAX_DOC_BYTES) throw badRequest(`The website ${which} in this file is too large.`);
  return doc as Prisma.InputJsonValue;
}

/**
 * Replace this installation's setup with the file's. Rooms, equipment and promo codes not in the
 * file are removed, or hidden if bookings use them. Bookings, customers and staff are untouched.
 */
export async function importSetup(file: SetupFile, actorId: string, ip: string | null) {
  const draft = checkSiteDoc(file.website.draft, 'draft');
  let published: Prisma.InputJsonValue | null = null;
  if (file.website.published !== null) {
    const parsed = siteDocSchema.safeParse(file.website.published);
    if (!parsed.success) throw badRequest('The live website in this file could not be read.');
    published = parsed.data as unknown as Prisma.InputJsonValue;
  }
  const photoIds = file.website.assets.map((a) => a.id);
  const present = new Set((await prisma.siteAsset.findMany({ where: { id: { in: photoIds } }, select: { id: true } })).map((a) => a.id));
  const missing = photoIds.filter((id) => !present.has(id));
  if (missing.length) throw badRequest(`${missing.length} website photo${missing.length === 1 ? ' was' : 's were'} not uploaded. Try the import again.`);

  const roomIds = new Set(file.rooms.map((r) => r.id));
  const now = new Date();
  const result = await prisma.$transaction(
    async (tx) => {
      await getSettings(tx);
      await tx.settings.update({ where: { id: 1 }, data: { ...file.settings, currency: file.currency, bookingRefPrefix: file.bookingRefPrefix, ...file.email } });

      for (const d of file.openingHours) {
        const row = { isOpen: d.isOpen, openMinute: timeToMinutes(d.openTime), closeMinute: timeToMinutes(d.closeTime) };
        await tx.openingHours.upsert({ where: { dayOfWeek: d.dayOfWeek }, create: { dayOfWeek: d.dayOfWeek, ...row }, update: row });
      }

      // Rooms keep their ids, so promo codes and closures in the file still point at them.
      for (const { id, priceRules, ...r } of file.rooms) {
        const data = { ...r, ratePlans: r.ratePlans as Prisma.InputJsonValue, lengthDiscounts: r.lengthDiscounts as Prisma.InputJsonValue };
        await tx.room.upsert({ where: { id }, create: { id, ...data }, update: data });
        await tx.priceRule.deleteMany({ where: { roomId: id } });
        if (priceRules.length) {
          await tx.priceRule.createMany({
            data: priceRules.map((p) => ({ roomId: id, label: p.label, daysOfWeek: p.daysOfWeek, startMinute: timeToMinutes(p.startTime), endMinute: timeToMinutes(p.endTime), hourlyRatePence: p.hourlyRatePence })),
          });
        }
      }
      const oldRooms = await tx.room.findMany({ where: { id: { notIn: [...roomIds] } }, select: { id: true, _count: { select: { bookings: true } } } });
      const hiddenRooms = oldRooms.filter((r) => r._count.bookings > 0).map((r) => r.id);
      if (hiddenRooms.length) await tx.room.updateMany({ where: { id: { in: hiddenRooms } }, data: { active: false } });
      await tx.room.deleteMany({ where: { id: { in: oldRooms.filter((r) => r._count.bookings === 0).map((r) => r.id) } } });

      const equipmentIds = file.equipment.map((e) => e.id);
      for (const { id, ...e } of file.equipment) await tx.equipment.upsert({ where: { id }, create: { id, ...e }, update: e });
      const oldEquipment = await tx.equipment.findMany({ where: { id: { notIn: equipmentIds } }, select: { id: true, _count: { select: { bookingItems: true } } } });
      await tx.equipment.updateMany({ where: { id: { in: oldEquipment.filter((e) => e._count.bookingItems > 0).map((e) => e.id) } }, data: { active: false } });
      await tx.equipment.deleteMany({ where: { id: { in: oldEquipment.filter((e) => e._count.bookingItems === 0).map((e) => e.id) } } });

      const codes = file.promoCodes.map((p) => p.code);
      for (const p of file.promoCodes) {
        const data = { ...p, roomIds: p.roomIds.filter((id) => roomIds.has(id)) };
        await tx.promoCode.upsert({ where: { code: p.code }, create: data, update: data });
      }
      const oldPromos = await tx.promoCode.findMany({ where: { code: { notIn: codes } }, select: { id: true, _count: { select: { bookings: true } } } });
      await tx.promoCode.updateMany({ where: { id: { in: oldPromos.filter((p) => p._count.bookings > 0).map((p) => p.id) } }, data: { active: false } });
      await tx.promoCode.deleteMany({ where: { id: { in: oldPromos.filter((p) => p._count.bookings === 0).map((p) => p.id) } } });

      // Upcoming closures are replaced; past ones stay as history.
      await tx.availabilityBlock.deleteMany({ where: { endsAt: { gt: now } } });
      const closures = file.closures.filter((c) => new Date(c.endsAt) > now && (c.roomId === null || roomIds.has(c.roomId)));
      if (closures.length) {
        await tx.availabilityBlock.createMany({ data: closures.map((c) => ({ roomId: c.roomId, startsAt: new Date(c.startsAt), endsAt: new Date(c.endsAt), reason: c.reason, createdById: actorId })) });
      }

      // Website: the file's working copy becomes the draft, and its live version is published here.
      const draftDoc = draft ?? published;
      if (draftDoc !== null) {
        await tx.siteDraft.upsert({
          where: { id: 1 },
          create: { id: 1, doc: draftDoc, builderLive: file.website.builderLive && published !== null, updatedById: actorId },
          update: { doc: draftDoc, revision: { increment: 1 }, builderLive: file.website.builderLive && published !== null, updatedById: actorId },
        });
      }
      if (published !== null) await tx.siteVersion.create({ data: { doc: published, note: `Imported from ${file.from.businessName}`, publishedById: actorId } });

      await audit(
        {
          action: 'settings.imported',
          actorId,
          targetType: 'settings',
          metadata: { from: file.from.publicUrl, exportedAt: file.exportedAt, rooms: file.rooms.length, equipment: file.equipment.length, promoCodes: codes.length, photos: photoIds.length },
          ipAddress: ip,
        },
        tx,
      );
      return { hiddenRooms: hiddenRooms.length, closures: closures.length };
    },
    { timeout: 60_000 },
  );
  applyIntegrations(await getSettings());

  return {
    rooms: file.rooms.length,
    equipment: file.equipment.length,
    promoCodes: file.promoCodes.length,
    closures: result.closures,
    photos: photoIds.length,
    hiddenRooms: result.hiddenRooms,
    /** Things the file can't carry: they're entered again on this installation. */
    toEnterAgain: [
      'Stripe secret key and webhook secret (Settings › Payments)',
      ...(file.email.smtpHost ? ['Email password (Settings › Email)'] : ['Email server (Settings › Email)']),
      'ApexBook monitoring key, if used (Settings › Monitoring)',
      'Staff logins (Staff)',
    ],
  };
}
