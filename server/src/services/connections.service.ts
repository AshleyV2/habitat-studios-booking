import type { ConnectionsDto, connectionsSchema } from '@habitat/shared';
import type { Prisma, Settings } from '@prisma/client';
import type { z } from 'zod';
import { env, publicLink } from '../config/env';
import { applyIntegrations, integrations } from '../config/integrations';
import { prisma } from '../db/prisma';
import { stripe } from '../stripe/client';
import { sealSecret } from '../utils/crypto';
import { badRequest } from '../utils/errors';
import { sendHeartbeat } from './apexbook-agent.service';
import { audit } from './audit.service';
import { getSettings } from './settings.service';

/*
 * Admin › Settings connections: Stripe, email (SMTP) and ApexBook monitoring, plus the booking
 * reference prefix. Saved here instead of the server's .env (which still applies to anything
 * left empty). Secrets are stored encrypted and never sent back, only whether they're set.
 */

/** Columns that hold connections; never part of the general settings payload. */
export const CONNECTION_COLUMNS = [
  'bookingRefPrefix',
  'stripeSecretKeyEnc',
  'stripeWebhookSecretEnc',
  'smtpHost',
  'smtpPort',
  'smtpSecurity',
  'smtpUser',
  'smtpPasswordEnc',
  'emailFromName',
  'emailFromAddress',
  'emailReplyTo',
  'apexbookApiUrl',
  'apexbookAgentTokenEnc',
  'apexbookHeartbeatMinutes',
] as const satisfies readonly (keyof Settings)[];

/** The general settings row without connections (and never any encrypted secret). */
export function generalSettings(s: Settings) {
  const out: Partial<Settings> = { ...s };
  for (const k of CONNECTION_COLUMNS) delete out[k];
  return out;
}

const keyHint = (key: string | null) => (key ? `${key.slice(0, 8)}…${key.slice(-4)}` : null);

export async function getConnections(): Promise<ConnectionsDto> {
  const s = await getSettings();
  const i = integrations();
  return {
    bookingRefPrefix: { value: s.bookingRefPrefix, effective: i.bookingRefPrefix, server: env.BOOKING_REF_PREFIX },
    stripe: {
      enabled: i.stripe.enabled,
      mode: i.stripe.secretKey ? (i.stripe.live ? 'live' : 'test') : null,
      secretKey: { set: Boolean(i.stripe.secretKey), source: i.source.stripeSecretKey, hint: keyHint(i.stripe.secretKey) },
      webhookSecret: { set: Boolean(i.stripe.webhookSecret), source: i.source.stripeWebhookSecret },
      webhookUrl: publicLink('/api/stripe/webhook'),
    },
    smtp: {
      enabled: i.smtp.enabled,
      source: i.source.smtp,
      host: s.smtpHost,
      port: s.smtpPort,
      security: (s.smtpSecurity as 'tls' | 'starttls' | 'none' | null) ?? null,
      user: s.smtpUser,
      password: { set: Boolean(i.smtp.password), source: i.source.smtpPassword },
      fromName: s.emailFromName,
      fromAddress: s.emailFromAddress,
      replyTo: s.emailReplyTo,
      server: { host: env.SMTP_HOST ?? null, fromAddress: env.EMAIL_FROM_ADDRESS ?? null, fromName: env.EMAIL_FROM_NAME ?? null },
    },
    apexbook: {
      enabled: i.apexbook.enabled,
      apiUrl: s.apexbookApiUrl,
      token: { set: Boolean(i.apexbook.agentToken), source: i.source.apexbookToken },
      heartbeatMinutes: s.apexbookHeartbeatMinutes,
      server: { apiUrl: env.APEXBOOK_API_URL ?? null, heartbeatMinutes: env.APEXBOOK_HEARTBEAT_MINUTES },
    },
    server: {
      publicUrl: env.PUBLIC_URL,
      additionalOrigins: env.ADDITIONAL_ORIGINS?.split(',').map((o) => o.trim()).filter(Boolean) ?? [],
      trustProxy: env.TRUST_PROXY,
      setupLinkConfigured: Boolean(env.SETUP_TOKEN),
    },
    unreadable: i.unreadable,
  };
}

/** A secret field: undefined = leave it, null = remove it, text = encrypt and save. */
const secret = (v: string | null | undefined) => (v === undefined ? undefined : v === null ? null : sealSecret(v));

export async function updateConnections(input: z.output<typeof connectionsSchema>, actorId: string, ip: string | null) {
  const before = await getSettings();
  if (input.smtpHost && !(input.emailFromAddress ?? env.EMAIL_FROM_ADDRESS)) {
    throw badRequest('Add the address emails are sent from.', { emailFromAddress: 'Required to send email' });
  }
  if (input.apexbookApiUrl && !input.apexbookApiUrl.startsWith('https://') && !env.APEXBOOK_ALLOW_INSECURE) {
    throw badRequest('The ApexBook address must start with https:// (the connection carries a secret key).', { apexbookApiUrl: 'Must start with https://' });
  }
  const data: Prisma.SettingsUpdateInput = {
    bookingRefPrefix: input.bookingRefPrefix,
    smtpHost: input.smtpHost,
    smtpPort: input.smtpPort,
    smtpSecurity: input.smtpSecurity,
    smtpUser: input.smtpUser,
    emailFromName: input.emailFromName,
    emailFromAddress: input.emailFromAddress,
    emailReplyTo: input.emailReplyTo,
    apexbookApiUrl: input.apexbookApiUrl,
    apexbookHeartbeatMinutes: input.apexbookHeartbeatMinutes,
    stripeSecretKeyEnc: secret(input.stripeSecretKey),
    stripeWebhookSecretEnc: secret(input.stripeWebhookSecret),
    smtpPasswordEnc: secret(input.smtpPassword),
    apexbookAgentTokenEnc: secret(input.apexbookAgentToken),
  };
  const updated = await prisma.settings.update({ where: { id: 1 }, data });
  applyIntegrations(updated);

  // What changed, by name only (secret values are never written to the audit log).
  const changed = (Object.keys(data) as (keyof typeof data)[]).filter((k) => data[k] !== undefined && (data[k] as unknown) !== (before as Record<string, unknown>)[k]);
  if (changed.length) await audit({ action: 'settings.connections_updated', actorId, targetType: 'settings', metadata: { fields: changed.map((k) => k.replace(/Enc$/, '')) }, ipAddress: ip });
  return getConnections();
}

/** "Test" buttons: try the connection now and say plainly what happened. */
export async function testConnection(service: 'stripe' | 'apexbook'): Promise<{ ok: boolean; detail: string }> {
  if (service === 'stripe') {
    const i = integrations().stripe;
    if (!i.secretKey) return { ok: false, detail: 'No Stripe secret key is set.' };
    try {
      await stripe().balance.retrieve();
      return {
        ok: true,
        detail: `Connected to Stripe in ${i.live ? 'LIVE mode: real payments are taken' : 'test mode: no real money moves'}.${i.webhookSecret ? '' : ' Add the webhook signing secret too, or bookings won’t confirm after payment.'}`,
      };
    } catch (err) {
      return { ok: false, detail: `Stripe refused the key: ${err instanceof Error ? err.message : 'unknown error'}` };
    }
  }
  if (!integrations().apexbook.enabled) return { ok: false, detail: 'Add the ApexBook address and monitoring key first.' };
  const r = await sendHeartbeat();
  return r.ok ? { ok: true, detail: 'ApexBook received a heartbeat. This system shows as online there.' } : { ok: false, detail: `Couldn’t reach ApexBook: ${r.error ?? 'unknown error'}` };
}
