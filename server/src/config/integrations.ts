import type { Settings } from '@prisma/client';
import { openSecret } from '../utils/crypto';
import { env } from './env';

/*
 * Connections to other services (Stripe, email, ApexBook monitoring) and the booking reference
 * prefix. Each is set in Admin › Settings; anything left empty there falls back to the server's
 * .env, so existing installs keep working. Kept in memory so every caller can read it at once;
 * reloaded whenever settings are saved (and on start).
 */

export type SmtpSecurity = 'tls' | 'starttls' | 'none';

export interface Integrations {
  bookingRefPrefix: string;
  stripe: { secretKey: string | null; webhookSecret: string | null; enabled: boolean; live: boolean };
  smtp: {
    host: string | null;
    port: number;
    security: SmtpSecurity;
    user: string | null;
    password: string | null;
    fromName: string | null;
    fromAddress: string | null;
    replyTo: string | null;
    enabled: boolean;
  };
  apexbook: { apiUrl: string | null; agentToken: string | null; heartbeatMinutes: number; enabled: boolean };
  /** Where each value came from, for the settings page. */
  source: Record<'stripeSecretKey' | 'stripeWebhookSecret' | 'smtp' | 'smtpPassword' | 'apexbookToken', 'settings' | 'server' | null>;
  /** Stored secrets that couldn't be decrypted (SESSION_SECRET changed since they were saved). */
  unreadable: string[];
}

type Stored = Pick<
  Settings,
  | 'bookingRefPrefix'
  | 'stripeSecretKeyEnc'
  | 'stripeWebhookSecretEnc'
  | 'smtpHost'
  | 'smtpPort'
  | 'smtpSecurity'
  | 'smtpUser'
  | 'smtpPasswordEnc'
  | 'emailFromName'
  | 'emailFromAddress'
  | 'emailReplyTo'
  | 'apexbookApiUrl'
  | 'apexbookAgentTokenEnc'
  | 'apexbookHeartbeatMinutes'
>;

export function buildIntegrations(s: Partial<Stored> | null): Integrations {
  const unreadable: string[] = [];
  const secret = (sealed: string | null | undefined, name: string) => {
    if (!sealed) return null;
    const v = openSecret(sealed);
    if (v === null) unreadable.push(name);
    return v;
  };
  const stripeKey = secret(s?.stripeSecretKeyEnc, 'Stripe secret key');
  const stripeHook = secret(s?.stripeWebhookSecretEnc, 'Stripe webhook secret');
  const smtpPassword = secret(s?.smtpPasswordEnc, 'email password');
  const apexToken = secret(s?.apexbookAgentTokenEnc, 'ApexBook monitoring key');

  const secretKey = stripeKey ?? env.STRIPE_SECRET_KEY ?? null;
  const webhookSecret = stripeHook ?? env.STRIPE_WEBHOOK_SECRET ?? null;

  // The email server is taken as a whole from one place, so settings never mix with .env.
  const smtpFromSettings = Boolean(s?.smtpHost);
  const security = ((smtpFromSettings ? s?.smtpSecurity : env.SMTP_SECURITY) ?? 'starttls') as SmtpSecurity;
  const smtp = smtpFromSettings
    ? { host: s!.smtpHost!, port: s?.smtpPort ?? null, user: s?.smtpUser ?? null, password: smtpPassword }
    : { host: env.SMTP_HOST ?? null, port: env.SMTP_PORT ?? null, user: env.SMTP_USER ?? null, password: env.SMTP_PASSWORD ?? null };
  const fromAddress = s?.emailFromAddress ?? env.EMAIL_FROM_ADDRESS ?? null;

  const apiUrl = s?.apexbookApiUrl ?? env.APEXBOOK_API_URL ?? null;
  const agentToken = apexToken ?? env.APEXBOOK_AGENT_TOKEN ?? null;

  return {
    bookingRefPrefix: s?.bookingRefPrefix ?? env.BOOKING_REF_PREFIX,
    stripe: { secretKey, webhookSecret, enabled: Boolean(secretKey && webhookSecret), live: Boolean(secretKey?.startsWith('sk_live_')) },
    smtp: {
      ...smtp,
      port: smtp.port ?? (security === 'tls' ? 465 : 587),
      security,
      fromName: s?.emailFromName ?? env.EMAIL_FROM_NAME ?? null,
      fromAddress,
      replyTo: s?.emailReplyTo ?? env.EMAIL_REPLY_TO ?? null,
      enabled: Boolean(smtp.host && fromAddress),
    },
    apexbook: { apiUrl, agentToken, heartbeatMinutes: s?.apexbookHeartbeatMinutes ?? env.APEXBOOK_HEARTBEAT_MINUTES, enabled: Boolean(apiUrl && agentToken) },
    source: {
      stripeSecretKey: stripeKey ? 'settings' : env.STRIPE_SECRET_KEY ? 'server' : null,
      stripeWebhookSecret: stripeHook ? 'settings' : env.STRIPE_WEBHOOK_SECRET ? 'server' : null,
      smtp: smtpFromSettings ? 'settings' : env.SMTP_HOST ? 'server' : null,
      smtpPassword: smtpFromSettings ? (smtpPassword ? 'settings' : null) : env.SMTP_PASSWORD ? 'server' : null,
      apexbookToken: apexToken ? 'settings' : env.APEXBOOK_AGENT_TOKEN ? 'server' : null,
    },
    unreadable,
  };
}

let current = buildIntegrations(null);
const listeners = new Set<(next: Integrations, prev: Integrations) => void>();

/** The connections in effect right now. */
export const integrations = () => current;

/** Recompute from the saved settings (call after saving them, and on start). */
export function applyIntegrations(s: Partial<Stored> | null) {
  const prev = current;
  current = buildIntegrations(s);
  for (const l of listeners) l(current, prev);
  return current;
}

/** Be told when connections change (e.g. to drop a cached Stripe client or mail transport). */
export function onIntegrationsChange(fn: (next: Integrations, prev: Integrations) => void) {
  listeners.add(fn);
}
