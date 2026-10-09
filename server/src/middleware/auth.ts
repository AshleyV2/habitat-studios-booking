import type { Permission } from '@habitat/shared';
import type { NextFunction, Request, Response } from 'express';
import { clearSessionCookie, SESSION_COOKIE } from '../auth/cookies';
import { resolveSession } from '../auth/session.service';
import { forbidden, unauthorized } from '../utils/errors';

export async function authenticate(req: Request, res: Response, next: NextFunction) {
  const token: unknown = req.cookies?.[SESSION_COOKIE];
  if (typeof token === 'string' && token.length > 0 && token.length < 200) {
    const auth = await resolveSession(token);
    if (auth) req.auth = auth;
    else clearSessionCookie(res);
  }
  next();
}

/** Every admin route declares the permission it needs; the check happens here, server-side. */
export function requirePermission(...permissions: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) throw unauthorized();
    for (const p of permissions) if (!req.auth.permissions.has(p)) throw forbidden();
    next();
  };
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth) throw unauthorized();
  next();
}

export function actor(req: Request) {
  if (!req.auth) throw unauthorized();
  return { actorId: req.auth.user.id, ip: req.ip ?? null };
}
