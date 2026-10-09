import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { HealthCheck, SystemHealthResponse } from '@habitat/shared';
import { env } from '../config/env';
import { prisma } from '../db/prisma';
import { smtpConfigured } from './email/transport';
import { integrations } from '../config/integrations';

const started = Date.now();

let cachedVersion: string | undefined;
/**
 * The installed version: the build tag when ApexBook hosts this site (BOOKING_RELEASE),
 * otherwise HABITAT/package.json (found by walking up from this file).
 */
export function appVersion(): string {
  if (cachedVersion) return cachedVersion;
  if (process.env.BOOKING_RELEASE) return (cachedVersion = process.env.BOOKING_RELEASE);
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const p = path.join(dir, 'package.json');
    if (fs.existsSync(p)) {
      const pkg = JSON.parse(fs.readFileSync(p, 'utf8')) as { name?: string; version?: string };
      if (pkg.name === 'habitat-booking') return (cachedVersion = pkg.version ?? 'unknown');
    }
    dir = path.dirname(dir);
  }
  return (cachedVersion = process.env.APP_VERSION ?? 'unknown');
}

export const uptimeSeconds = () => Math.round((Date.now() - started) / 1000);

async function state<T>(key: string): Promise<T | null> {
  const row = await prisma.systemState.findUnique({ where: { key } });
  return (row?.value as T) ?? null;
}

export async function databaseCheck(): Promise<HealthCheck> {
  const t = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    const failed = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM "_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL`;
    const applied = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`;
    if (Number(failed[0]?.n ?? 0) > 0) return { name: 'Database', status: 'error', detail: 'A database migration did not finish. See docs/UPDATING.md before continuing.' };
    return { name: 'Database', status: 'ok', detail: `Local PostgreSQL responding in ${Date.now() - t} ms · ${applied[0]?.n ?? 0} migrations applied` };
  } catch (err) {
    return { name: 'Database', status: 'error', detail: err instanceof Error ? err.message.split('\n')[0]! : 'Unreachable' };
  }
}

function backupCheck(): HealthCheck {
  if (!env.BACKUP_DIR) return { name: 'Backups', status: 'not_configured', detail: 'BACKUP_DIR is not set, so backup status cannot be shown here.' };
  try {
    const status = JSON.parse(fs.readFileSync(path.join(env.BACKUP_DIR, 'last-backup.json'), 'utf8')) as { finishedAt: string; file: string; sizeBytes: number; ok: boolean; error?: string };
    const ageH = (Date.now() - Date.parse(status.finishedAt)) / 3600_000;
    if (!status.ok) return { name: 'Backups', status: 'error', detail: `Last backup failed at ${status.finishedAt}: ${status.error ?? 'unknown error'}` };
    const detail = `Last backup ${status.file} (${(status.sizeBytes / 1024 / 1024).toFixed(1)} MB) at ${new Date(status.finishedAt).toLocaleString('en-GB')}`;
    return { name: 'Backups', status: ageH > 26 ? 'warning' : 'ok', detail: ageH > 26 ? `${detail} — more than a day old` : detail };
  } catch {
    return { name: 'Backups', status: 'warning', detail: 'No backup has been recorded yet.' };
  }
}

export async function systemHealth(): Promise<SystemHealthResponse> {
  const [db, lastWebhook, heartbeat, pendingEmail, failedEmail, lastSent, stuckHolds] = await Promise.all([
    databaseCheck(),
    state<{ at: string; type: string }>('stripe.lastWebhookAt'),
    state<{ ok: boolean; at: string; error?: string }>('apexbook.heartbeat'),
    prisma.emailMessage.count({ where: { status: 'PENDING' } }),
    prisma.emailMessage.count({ where: { status: 'FAILED' } }),
    prisma.emailMessage.findFirst({ where: { status: 'SENT' }, orderBy: { sentAt: 'desc' }, select: { sentAt: true } }),
    prisma.booking.count({ where: { status: 'PENDING_PAYMENT', expiresAt: { lt: new Date(Date.now() - 15 * 60_000) } } }),
  ]);

  const checks: HealthCheck[] = [db];
  checks.push(
    integrations().stripe.enabled
      ? {
          name: 'Stripe payments',
          status: integrations().stripe.live ? 'ok' : 'warning',
          detail: `${integrations().stripe.live ? 'Live mode' : 'TEST MODE — no real payments are taken'} · ${lastWebhook ? `last webhook ${new Date(lastWebhook.at).toLocaleString('en-GB')} (${lastWebhook.type})` : 'no webhook received yet'}`,
        }
      : { name: 'Stripe payments', status: 'not_configured', detail: 'Stripe keys not set (Settings › Payments) — online booking is unavailable to customers.' },
  );
  checks.push(
    smtpConfigured()
      ? {
          name: 'Email (SMTP)',
          status: failedEmail > 0 ? 'error' : pendingEmail > 10 ? 'warning' : 'ok',
          detail: `${pendingEmail} queued, ${failedEmail} failed · ${lastSent?.sentAt ? `last sent ${lastSent.sentAt.toLocaleString('en-GB')}` : 'nothing sent yet'}`,
        }
      : { name: 'Email (SMTP)', status: 'not_configured', detail: `Email is not set up (Settings › Email) — ${pendingEmail} email(s) are waiting in the outbox and will send once it is.` },
  );
  checks.push(backupCheck());
  checks.push(
    stuckHolds
      ? { name: 'Payment holds', status: 'warning', detail: `${stuckHolds} unpaid booking(s) past their hold — the background jobs may not be running.` }
      : { name: 'Payment holds', status: 'ok', detail: 'No stale payment holds' },
  );
  checks.push(
    !integrations().apexbook.enabled
      ? { name: 'ApexBook management link', status: 'not_configured', detail: 'Optional. Bookings do not depend on it.' }
      : !heartbeat
        ? { name: 'ApexBook management link', status: 'warning', detail: 'No heartbeat sent yet.' }
        : heartbeat.ok
          ? { name: 'ApexBook management link', status: 'ok', detail: `Last heartbeat ${new Date(heartbeat.at).toLocaleString('en-GB')}` }
          : { name: 'ApexBook management link', status: 'warning', detail: `Last heartbeat failed ${new Date(heartbeat.at).toLocaleString('en-GB')}: ${heartbeat.error ?? 'unknown'}. Local operation is unaffected.` },
  );
  return { version: appVersion(), uptimeSeconds: uptimeSeconds(), checks };
}
