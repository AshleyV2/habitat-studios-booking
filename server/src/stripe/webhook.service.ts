import { Prisma } from '@prisma/client';
import type Stripe from 'stripe';
import { env } from '../config/env';
import { prisma } from '../db/prisma';
import { applyExpiredCheckout, applyPaidCheckout, syncStripeRefunds, type AfterCommit } from '../services/payment.service';
import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';
import { idOf, stripe } from './client';
import { integrations } from '../config/integrations';

export const HANDLED_EVENTS = new Set([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'checkout.session.expired',
  'charge.refunded',
]);

export function verifyEvent(rawBody: Buffer, signature: string | undefined): Stripe.Event {
  if (!integrations().stripe.enabled) throw new AppError(503, 'service_unavailable', 'Stripe is not configured on this installation.');
  if (!signature) throw new AppError(400, 'invalid_signature', 'Missing Stripe signature.');
  try {
    return stripe().webhooks.constructEvent(rawBody, signature, integrations().stripe.webhookSecret!);
  } catch {
    throw new AppError(400, 'invalid_signature', 'Invalid Stripe signature.');
  }
}

/**
 * The webhook is the source of truth for payment. Each event is recorded in the
 * StripeEvent ledger inside the same transaction as its effects, so a redelivery is a
 * no-op and a failure leaves nothing behind (Stripe retries).
 */
export async function processEvent(event: Stripe.Event): Promise<'processed' | 'duplicate' | 'ignored'> {
  await prisma.systemState.upsert({
    where: { key: 'stripe.lastWebhookAt' },
    create: { key: 'stripe.lastWebhookAt', value: { at: new Date().toISOString(), type: event.type } },
    update: { value: { at: new Date().toISOString(), type: event.type } },
  });
  if (!HANDLED_EVENTS.has(event.type)) return 'ignored';

  let after: AfterCommit[] = [];
  try {
    const result = await prisma.$transaction(
      async (tx) => {
        if (await tx.stripeEvent.findUnique({ where: { id: event.id } })) return 'duplicate' as const;
        await tx.stripeEvent.create({ data: { id: event.id, type: event.type } });

        switch (event.type) {
          case 'checkout.session.completed':
          case 'checkout.session.async_payment_succeeded': {
            const session = event.data.object as Stripe.Checkout.Session;
            // Card payments arrive 'paid'; delayed methods wait for async_payment_succeeded.
            if (session.payment_status === 'paid' || session.payment_status === 'no_payment_required') {
              after = (await applyPaidCheckout(tx, session)).after;
            }
            break;
          }
          case 'checkout.session.async_payment_failed':
          case 'checkout.session.expired':
            await applyExpiredCheckout(tx, event.data.object as Stripe.Checkout.Session);
            break;
          case 'charge.refunded': {
            const charge = event.data.object as Stripe.Charge;
            const pi = idOf(charge.payment_intent);
            if (pi) {
              const payment = await tx.payment.findUnique({ where: { stripePaymentIntentId: pi } });
              if (payment) await tx.payment.update({ where: { id: payment.id }, data: { refundedPence: Math.min(charge.amount_refunded, payment.amountPence) } });
            }
            break;
          }
        }
        return 'processed' as const;
      },
      { timeout: 20_000, maxWait: 10_000 },
    );
    for (const fn of after) await fn().catch((err) => logger.error({ err }, 'Post-webhook task failed'));
    return result;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return 'duplicate';
    throw err;
  }
}

export { syncStripeRefunds };
