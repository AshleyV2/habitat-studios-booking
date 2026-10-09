import { prisma, type Tx } from '../../db/prisma';
import { logger } from '../../utils/logger';
import { deliver, smtpConfigured } from './transport';

export interface QueuedEmail {
  kind: string;
  to: string;
  subject: string;
  text: string;
  ics?: string | null;
  bookingId?: string | null;
}

/**
 * Queue an email. Pass the booking transaction so the email is recorded atomically
 * with the change it describes — it can never be "sent" for a change that rolled back,
 * and an SMTP outage never loses it.
 */
export async function enqueueEmail(email: QueuedEmail, tx: Tx = prisma) {
  return tx.emailMessage.create({ data: { ...email, ics: email.ics ?? null, bookingId: email.bookingId ?? null } });
}

const BACKOFF_MINUTES = [1, 5, 15, 30, 60, 120, 240, 480, 720, 1440];
const MAX_ATTEMPTS = BACKOFF_MINUTES.length;

let running = false;

/** Deliver due emails. Called by the scheduler and after actions that queue mail. */
export async function processOutbox(limit = 25): Promise<{ sent: number; failed: number }> {
  if (running) return { sent: 0, failed: 0 };
  running = true;
  let sent = 0;
  let failed = 0;
  try {
    if (!smtpConfigured()) return { sent, failed };
    const due = await prisma.emailMessage.findMany({
      where: { status: 'PENDING', nextAttemptAt: { lte: new Date() } },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
    for (const m of due) {
      try {
        await deliver(m);
        await prisma.emailMessage.update({ where: { id: m.id }, data: { status: 'SENT', sentAt: new Date(), attempts: m.attempts + 1, lastError: null } });
        sent++;
      } catch (err) {
        const attempts = m.attempts + 1;
        const giveUp = attempts >= MAX_ATTEMPTS;
        await prisma.emailMessage.update({
          where: { id: m.id },
          data: {
            attempts,
            status: giveUp ? 'FAILED' : 'PENDING',
            lastError: (err instanceof Error ? err.message : String(err)).slice(0, 500),
            nextAttemptAt: new Date(Date.now() + (BACKOFF_MINUTES[attempts - 1] ?? 1440) * 60000),
          },
        });
        failed++;
        logger.warn({ emailId: m.id, kind: m.kind, attempts, err }, 'Email delivery failed');
      }
    }
  } finally {
    running = false;
  }
  return { sent, failed };
}

/** Kick delivery without making the caller wait for SMTP. */
export function flushOutboxSoon() {
  setImmediate(() => {
    processOutbox().catch((err) => logger.error({ err }, 'Outbox processing failed'));
  });
}

export async function retryEmail(id: string) {
  return prisma.emailMessage.update({ where: { id }, data: { status: 'PENDING', nextAttemptAt: new Date(), attempts: 0 } });
}
