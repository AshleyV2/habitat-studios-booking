import { env } from '../config/env';
import { prisma } from '../db/prisma';
import { logger } from '../utils/logger';
import { appVersion, databaseCheck, uptimeSeconds } from './health.service';
import { integrations } from '../config/integrations';

/**
 * Optional link to the ApexBook management platform.
 *
 * Sends a small heartbeat (version, uptime, component health — no customer or booking
 * data) over HTTPS with this installation's agent token. It is fire-and-forget: a
 * failure is recorded for the System health page and nothing else happens. Bookings,
 * payments and the admin interface never wait on it.
 */
export async function sendHeartbeat(): Promise<{ ok: boolean; error?: string }> {
  const apex = integrations().apexbook;
  if (!apex.enabled) return { ok: false, error: 'not configured' };
  const url = new URL('/api/agent/heartbeat', apex.apiUrl!).toString();
  let result: { ok: boolean; error?: string };
  try {
    const db = await databaseCheck();
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apex.agentToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        softwareVersion: appVersion(),
        uptimeSeconds: uptimeSeconds(),
        health: {
          database: db.status,
          stripe: integrations().stripe.enabled ? 'configured' : 'not_configured',
          smtp: integrations().smtp.enabled ? 'configured' : 'not_configured',
        },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    result = res.ok ? { ok: true } : { ok: false, error: `ApexBook responded ${res.status}` };
  } catch (err) {
    result = { ok: false, error: err instanceof Error ? err.message : 'request failed' };
  }
  const value = { ...result, at: new Date().toISOString() };
  await prisma.systemState
    .upsert({ where: { key: 'apexbook.heartbeat' }, create: { key: 'apexbook.heartbeat', value }, update: { value } })
    .catch(() => undefined);
  if (!result.ok) logger.warn({ error: result.error }, 'ApexBook heartbeat failed (local operation unaffected)');
  return result;
}
