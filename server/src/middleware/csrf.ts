import type { NextFunction, Request, Response } from 'express';
import { CSRF_COOKIE, CSRF_HEADER, setCsrfCookie } from '../auth/cookies';
import { env } from '../config/env';
import { generateToken, safeEqual } from '../utils/crypto';
import { AppError } from '../utils/errors';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

export function issueCsrfCookie(req: Request, res: Response, next: NextFunction) {
  if (!req.cookies?.[CSRF_COOKIE]) {
    const token = generateToken(24);
    setCsrfCookie(res, token);
    req.cookies = { ...req.cookies, [CSRF_COOKIE]: token };
  }
  next();
}

/** SameSite cookies + Origin check + double-submit token (as in the ApexBook platform). */
export function verifyCsrf(req: Request, _res: Response, next: NextFunction) {
  if (SAFE.has(req.method)) return next();
  const origin = req.get('origin') ?? refererOrigin(req.get('referer'));
  if (origin && !env.allowedOrigins.has(origin)) throw new AppError(403, 'csrf_origin', 'Request origin not allowed.');
  const cookie = req.cookies?.[CSRF_COOKIE];
  const header = req.get(CSRF_HEADER);
  if (typeof cookie !== 'string' || !header || !safeEqual(cookie, header)) {
    throw new AppError(403, 'csrf_invalid', 'Your security token is missing or out of date. Refresh the page and try again.');
  }
  next();
}

function refererOrigin(referer?: string) {
  if (!referer) return undefined;
  try {
    return new URL(referer).origin;
  } catch {
    return 'invalid';
  }
}
