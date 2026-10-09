import type { setupSchema } from '@habitat/shared';
import type { z } from 'zod';
import { hashPassword } from '../auth/password';
import { createSession } from '../auth/session.service';
import { env } from '../config/env';
import { prisma } from '../db/prisma';
import { safeEqual } from '../utils/crypto';
import { AppError } from '../utils/errors';
import { audit } from './audit.service';
import { getSettings } from './settings.service';

/*
 * First-run setup for a fresh (e.g. cloud-hosted) installation. While no administrator
 * exists and SETUP_TOKEN is configured, the site sends visitors to /setup, where whoever
 * holds the setup link creates the first administrator and the business details.
 * Once an administrator exists, setup is closed for good (the token no longer does anything).
 */

export async function isSetupRequired() {
  if (!env.SETUP_TOKEN) return false;
  return (await prisma.staffUser.count({ where: { role: 'ADMIN' } })) === 0;
}

export async function completeSetup(input: z.output<typeof setupSchema>, meta: { ipAddress: string | null; userAgent: string | null }) {
  if (!env.SETUP_TOKEN || !safeEqual(input.token, env.SETUP_TOKEN)) {
    throw new AppError(403, 'invalid_setup_token', 'That setup link or code is not valid. Use the link you were sent.');
  }
  const passwordHash = await hashPassword(input.password);
  const user = await prisma.$transaction(async (tx) => {
    // One setup only, even if two people submit at once.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(724001)`;
    if ((await tx.staffUser.count({ where: { role: 'ADMIN' } })) > 0) {
      throw new AppError(409, 'setup_done', 'This booking system has already been set up. Sign in instead.');
    }
    await getSettings(tx);
    await tx.settings.update({
      where: { id: 1 },
      data: {
        businessName: input.businessName,
        timezone: input.timezone,
        contactEmail: input.contactEmail ?? input.adminEmail,
        contactPhone: input.contactPhone ?? null,
        adminNotifyEmail: input.adminEmail,
      },
    });
    return tx.staffUser.upsert({
      where: { email: input.adminEmail },
      update: { role: 'ADMIN', passwordHash, name: input.adminName, disabledAt: null },
      create: { email: input.adminEmail, name: input.adminName, role: 'ADMIN', passwordHash },
    });
  });
  await audit({ action: 'setup.completed', actorId: user.id, metadata: { businessName: input.businessName }, ipAddress: meta.ipAddress });
  const token = await createSession(user.id, meta);
  return { user, token };
}
