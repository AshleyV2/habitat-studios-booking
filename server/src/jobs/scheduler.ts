import { purgeExpiredSessions } from '../auth/session.service';
import { env } from '../config/env';
import { integrations } from '../config/integrations';
import { prisma } from '../db/prisma';
import { expireStaleHolds } from '../services/availability.service';
import { sendHeartbeat } from '../services/apexbook-agent.service';
import { processOutbox } from '../services/email/outbox';
import { reconcilePendingPayments } from '../services/payment.service';
import { logger } from '../utils/logger';

interface Job {
  name: string;
  everyMs: number;
  run: () => Promise<unknown>;
  /** Checked on every run, so switching a service on or off in Settings applies without a restart. */
  enabled?: () => boolean;
}

let lastHeartbeat = 0;
/** The ApexBook heartbeat runs at the interval set in Settings (checked every minute). */
async function heartbeatIfDue() {
  const due = lastHeartbeat + integrations().apexbook.heartbeatMinutes * 60_000;
  if (Date.now() < due) return;
  lastHeartbeat = Date.now();
  await sendHeartbeat();
}

const jobs: Job[] = [
  { name: 'email-outbox', everyMs: 30_000, run: () => processOutbox() },
  { name: 'expire-holds', everyMs: 60_000, run: () => prisma.$transaction((tx) => expireStaleHolds(tx)) },
  { name: 'reconcile-payments', everyMs: 5 * 60_000, run: () => reconcilePendingPayments(), enabled: () => integrations().stripe.enabled },
  { name: 'purge-sessions', everyMs: 60 * 60_000, run: () => purgeExpiredSessions() },
  { name: 'apexbook-heartbeat', everyMs: 60_000, run: () => heartbeatIfDue(), enabled: () => integrations().apexbook.enabled },
];

const timers: NodeJS.Timeout[] = [];

/** Background maintenance. Each job is isolated: a failure is logged and retried next tick. */
export function startJobs() {
  if (!env.JOBS_ENABLED) return;
  for (const job of jobs) {
    let busy = false;
    const tick = async () => {
      if (busy || (job.enabled && !job.enabled())) return;
      busy = true;
      try {
        await job.run();
      } catch (err) {
        logger.error({ err, job: job.name }, 'Background job failed');
      } finally {
        busy = false;
      }
    };
    const t = setInterval(tick, job.everyMs);
    t.unref();
    timers.push(t);
    setTimeout(tick, 5_000).unref();
  }
  logger.info({ jobs: jobs.map((j) => j.name) }, 'Background jobs started');
}

export function stopJobs() {
  for (const t of timers) clearInterval(t);
  timers.length = 0;
}
