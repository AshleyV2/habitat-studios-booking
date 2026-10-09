import { minutesToTime, timeToMinutes, type settingsSchema, type openingHoursSchema } from '@habitat/shared';
import type { OpeningHours, Settings } from '@prisma/client';
import type { z } from 'zod';
import { env } from '../config/env';
import { prisma, type Tx } from '../db/prisma';
import { audit } from './audit.service';

/**
 * Settings are a single row. On a fresh installation it is created with neutral
 * defaults and the business name/timezone from the environment; everything else is
 * configured by the studio's administrator. Nothing about rooms, prices or hours is invented.
 */
export async function getSettings(db: Tx = prisma): Promise<Settings> {
  const existing = await db.settings.findUnique({ where: { id: 1 } });
  if (existing) return existing;
  return db.settings.upsert({
    where: { id: 1 },
    create: { id: 1, businessName: env.BUSINESS_NAME, timezone: env.BUSINESS_TIMEZONE },
    update: {},
  });
}

export async function updateSettings(input: z.output<typeof settingsSchema>, actorId: string, ip: string | null) {
  await getSettings();
  const before = await prisma.settings.findUniqueOrThrow({ where: { id: 1 } });
  const changed = (Object.keys(input) as (keyof typeof input)[]).filter((k) => input[k] !== before[k]);
  const updated = await prisma.settings.update({ where: { id: 1 }, data: input });
  if (changed.length) await audit({ action: 'settings.updated', actorId, targetType: 'settings', metadata: { fields: changed }, ipAddress: ip });
  return updated;
}

/** All seven days, closed by default until the administrator sets hours. */
export async function getOpeningHours(db: Tx = prisma): Promise<OpeningHours[]> {
  const rows = await db.openingHours.findMany({ orderBy: { dayOfWeek: 'asc' } });
  if (rows.length === 7) return rows;
  const byDay = new Map(rows.map((r) => [r.dayOfWeek, r]));
  return Array.from({ length: 7 }, (_, d) => byDay.get(d) ?? { dayOfWeek: d, isOpen: false, openMinute: 600, closeMinute: 1320 });
}

export function openingHoursDto(rows: OpeningHours[]) {
  return rows.map((r) => ({ dayOfWeek: r.dayOfWeek, isOpen: r.isOpen, openTime: minutesToTime(r.openMinute), closeTime: minutesToTime(r.closeMinute) }));
}

export async function setOpeningHours(days: z.output<typeof openingHoursSchema>, actorId: string, ip: string | null) {
  await prisma.$transaction(async (tx) => {
    for (const d of days) {
      let openMinute = timeToMinutes(d.openTime);
      let closeMinute = timeToMinutes(d.closeTime);
      // Times on a closed day are only remembered for convenience; keep them valid.
      if (!d.isOpen && closeMinute <= openMinute) [openMinute, closeMinute] = [600, 1320];
      const data = { isOpen: d.isOpen, openMinute, closeMinute };
      await tx.openingHours.upsert({ where: { dayOfWeek: d.dayOfWeek }, create: { dayOfWeek: d.dayOfWeek, ...data }, update: data });
    }
    await audit({ action: 'hours.updated', actorId, targetType: 'opening_hours', metadata: { days }, ipAddress: ip }, tx);
  });
  return getOpeningHours();
}
