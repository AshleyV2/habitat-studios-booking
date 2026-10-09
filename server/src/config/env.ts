import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

// Load HABITAT/.env regardless of the workspace the process starts in.
// Variables already set in the environment (e.g. by Docker) always win.
const here = path.dirname(fileURLToPath(import.meta.url));
loadDotenv({
  path: [path.resolve(process.cwd(), '.env'), path.resolve(process.cwd(), '..', '.env'), path.resolve(here, '..', '..', '..', '.env')],
  quiet: true,
});

const bool = (def: boolean) =>
  z
    .enum(['true', 'false', '1', '0', ''])
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : v === 'true' || v === '1'));
const opt = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== '' ? v.trim() : undefined));

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(8080),
    API_PORT: z.coerce.number().int().positive().optional(),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

    SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
    SESSION_TTL_HOURS: z.coerce.number().positive().default(12),
    SESSION_IDLE_HOURS: z.coerce.number().positive().default(4),

    /** Public address customers use, including any path, e.g. https://www.habitatstudio.co.uk */
    PUBLIC_URL: z.string().url(),
    /** Other origins staff may use, e.g. a LAN hostname: https://habitat.lan */
    ADDITIONAL_ORIGINS: opt,
    TRUST_PROXY: z.coerce.number().int().min(0).default(0),
    SERVE_CLIENT: bool(false),

    /** Used only to initialise settings on first start; edit afterwards in admin. */
    BUSINESS_NAME: z.string().default('Your Studio'),
    /** Start of booking references, e.g. BK-7K3Q9X. 2–5 capital letters. */
    BOOKING_REF_PREFIX: z.string().regex(/^[A-Z]{2,5}$/, '2–5 capital letters').default('BK'),
    BUSINESS_TIMEZONE: z.string().default('Europe/London'),

    STRIPE_SECRET_KEY: opt,
    STRIPE_WEBHOOK_SECRET: opt,

    SMTP_HOST: opt,
    SMTP_PORT: z.coerce.number().int().positive().optional(),
    SMTP_USER: opt,
    SMTP_PASSWORD: opt,
    /** tls = implicit TLS (465), starttls = upgrade (587), none = plain (LAN relays only) */
    SMTP_SECURITY: z.enum(['tls', 'starttls', 'none']).default('starttls'),
    /** Sender name on emails. Blank = the business name from Admin › Settings. */
    EMAIL_FROM_NAME: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
    EMAIL_FROM_ADDRESS: opt,
    EMAIL_REPLY_TO: opt,

    BACKUP_DIR: opt,
    LOG_DIR: opt,
    LOG_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

    JOBS_ENABLED: bool(true),

    // Optional ApexBook management link (never required for bookings to work).
    APEXBOOK_API_URL: opt,
    APEXBOOK_AGENT_TOKEN: opt,
    APEXBOOK_HEARTBEAT_MINUTES: z.coerce.number().int().min(1).max(1440).default(5),
    APEXBOOK_ALLOW_INSECURE: bool(false),

    /** First-run setup: the secret in the setup link (only works until an administrator exists). */
    SETUP_TOKEN: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(20, 'At least 20 characters').optional()),
  })
  .superRefine((e, ctx) => {
    if (e.NODE_ENV === 'production' && !e.PUBLIC_URL.startsWith('https://')) {
      ctx.addIssue({ code: 'custom', path: ['PUBLIC_URL'], message: 'PUBLIC_URL must use https in production' });
    }
    if (e.SMTP_HOST && !e.EMAIL_FROM_ADDRESS) {
      ctx.addIssue({ code: 'custom', path: ['EMAIL_FROM_ADDRESS'], message: 'Required when SMTP_HOST is set' });
    }
    if (e.APEXBOOK_API_URL && !e.APEXBOOK_ALLOW_INSECURE && !e.APEXBOOK_API_URL.startsWith('https://')) {
      ctx.addIssue({ code: 'custom', path: ['APEXBOOK_API_URL'], message: 'Must be https (the connection carries a secret token)' });
    }
    try {
      new Intl.DateTimeFormat('en-GB', { timeZone: e.BUSINESS_TIMEZONE });
    } catch {
      ctx.addIssue({ code: 'custom', path: ['BUSINESS_TIMEZONE'], message: 'Unknown timezone' });
    }
  });

// `KEY=` in .env means "not set" (so an empty SMTP_PORT falls back to its default).
const parsed = schema.safeParse(Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined && v.trim() !== '')));
if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  console.error(`Invalid environment configuration:\n${issues}`);
  throw new Error('Invalid environment configuration');
}
const e = parsed.data;
const publicUrl = new URL(e.PUBLIC_URL);
const basePath = publicUrl.pathname.replace(/\/+$/, '');

export const env = {
  ...e,
  PORT: e.API_PORT ?? e.PORT,
  isProduction: e.NODE_ENV === 'production',
  isTest: e.NODE_ENV === 'test',
  /** URL path prefix the app is served under ('' for a dedicated (sub)domain). */
  basePath,
  publicOrigin: publicUrl.origin,
  allowedOrigins: new Set([publicUrl.origin, ...(e.ADDITIONAL_ORIGINS?.split(',').map((o) => new URL(o.trim()).origin) ?? [])]),
  stripeEnabled: Boolean(e.STRIPE_SECRET_KEY && e.STRIPE_WEBHOOK_SECRET),
  smtpEnabled: Boolean(e.SMTP_HOST && e.EMAIL_FROM_ADDRESS),
  apexbookEnabled: Boolean(e.APEXBOOK_API_URL && e.APEXBOOK_AGENT_TOKEN),
} as const;

/** Absolute public URL for a path inside the app (emails, Stripe redirects). */
export function publicLink(pathAndQuery: string): string {
  return `${env.publicOrigin}${env.basePath}${pathAndQuery.startsWith('/') ? '' : '/'}${pathAndQuery}`;
}
