import { createHmac, randomBytes } from 'node:crypto';
import { env } from '../config/env';
import { safeEqual } from './crypto';

// The customer's private "manage booking" link token. It is derived, not stored:
// HMAC(SESSION_SECRET, booking id + per-booking salt). The server can rebuild it for
// any email, a database leak alone reveals nothing, and rotating the salt revokes it.

export const newManageSalt = () => randomBytes(16).toString('base64url');

export function manageToken(bookingId: string, salt: string): string {
  return createHmac('sha256', env.SESSION_SECRET).update(`manage:${bookingId}:${salt}`).digest('base64url');
}

export function verifyManageToken(bookingId: string, salt: string, token: string): boolean {
  return safeEqual(manageToken(bookingId, salt), token);
}
