import type { Request } from 'express';
import rateLimit, { type Options } from 'express-rate-limit';
import { env } from '../config/env';

// Single on-site instance, so the in-memory store is correct.
const common: Partial<Options> = {
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: () => env.isTest && process.env.RATE_LIMIT_IN_TESTS !== 'true',
  message: { error: { code: 'rate_limited', message: 'Too many requests. Please wait a few minutes and try again.' } },
};

export const apiLimiter = rateLimit({ ...common, windowMs: 15 * 60_000, limit: 900 });
export const loginLimiter = rateLimit({ ...common, windowMs: 15 * 60_000, limit: 20 });
export const loginAccountLimiter = rateLimit({
  ...common,
  windowMs: 15 * 60_000,
  limit: 10,
  keyGenerator: (req: Request) => `login:${String(req.body?.email ?? '').trim().toLowerCase().slice(0, 254)}`,
});
export const emailLimiter = rateLimit({ ...common, windowMs: 60 * 60_000, limit: 10 });
/** Creating online bookings (each holds a slot and a Stripe session). */
export const bookingLimiter = rateLimit({ ...common, windowMs: 15 * 60_000, limit: 15 });
/** Cancelling via the customer's private link. */
export const manageLimiter = rateLimit({ ...common, windowMs: 15 * 60_000, limit: 60 });

/** Website images: many per page view, served from the database. */
export const assetLimiter = rateLimit({ ...common, windowMs: 60_000, limit: 600 });
