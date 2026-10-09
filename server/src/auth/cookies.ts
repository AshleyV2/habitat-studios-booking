import type { CookieOptions, Response } from 'express';
import { env } from '../config/env';

// Same cookie design as the ApexBook platform. `__Host-` requires Path=/, so when the
// app is mounted under a path (e.g. /book) the `__Secure-` prefix is used instead.
const prefix = !env.isProduction ? '' : env.basePath ? '__Secure-' : '__Host-';
export const SESSION_COOKIE = `${prefix}habitat_session`;
export const CSRF_COOKIE = `${prefix}habitat_csrf`;
export const CSRF_HEADER = 'x-csrf-token';

const base: CookieOptions = {
  secure: env.isProduction,
  sameSite: 'lax',
  path: env.basePath || '/',
};

export function setSessionCookie(res: Response, token: string) {
  res.cookie(SESSION_COOKIE, token, { ...base, httpOnly: true, maxAge: env.SESSION_TTL_HOURS * 3600_000 });
}
export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, { ...base, httpOnly: true });
}
export function setCsrfCookie(res: Response, token: string) {
  res.cookie(CSRF_COOKIE, token, { ...base, httpOnly: false });
}
