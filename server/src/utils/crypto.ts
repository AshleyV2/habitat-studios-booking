import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env';

/** 256-bit URL-safe random token. */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * Session, reset, invite and verification tokens are stored only as a keyed
 * hash (HMAC-SHA256 with SESSION_SECRET). A database leak alone exposes no
 * usable token. Rotating SESSION_SECRET invalidates every outstanding token.
 */
export function hashToken(token: string): string {
  return createHmac('sha256', env.SESSION_SECRET).update(token).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

// ---------------------------------------------------------------------------
// Secrets kept in the database (Stripe keys, SMTP password, ApexBook token)
// ---------------------------------------------------------------------------

const sealKey = () => createHash('sha256').update(`booking-settings-secrets:${env.SESSION_SECRET}`).digest();

/** Encrypt a secret for storage (AES-256-GCM, key derived from SESSION_SECRET). */
export function sealSecret(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', sealKey(), iv);
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return `v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${data.toString('base64')}`;
}

/** Decrypt a stored secret; null if it can't be read (e.g. SESSION_SECRET was changed). */
export function openSecret(sealed: string | null | undefined): string | null {
  if (!sealed) return null;
  const [v, iv, tag, data] = sealed.split(':');
  if (v !== 'v1' || !iv || !tag || !data) return null;
  try {
    const d = createDecipheriv('aes-256-gcm', sealKey(), Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}
