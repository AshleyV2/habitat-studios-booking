import { changePasswordSchema, forgotPasswordSchema, loginSchema, permissionsList, resetPasswordSchema, setupSchema, type MeResponse } from '@habitat/shared';
import type { Request, Response } from 'express';
import { clearSessionCookie, setCsrfCookie, setSessionCookie } from '../auth/cookies';
import { destroySession } from '../auth/session.service';
import { env } from '../config/env';
import { audit } from '../services/audit.service';
import { completeSetup, isSetupRequired } from '../services/setup.service';
import * as staff from '../services/staff.service';
import { generateToken } from '../utils/crypto';
import { unauthorized } from '../utils/errors';
import { parse } from '../utils/validate';

export const authController = {
  csrf(_req: Request, res: Response) {
    res.status(204).end();
  },

  async login(req: Request, res: Response) {
    const { email, password } = parse(loginSchema, req.body);
    if (req.auth) await destroySession(req.auth.sessionId);
    const { user, token } = await staff.login(email, password, { ipAddress: req.ip ?? null, userAgent: req.get('user-agent') ?? null });
    setSessionCookie(res, token);
    setCsrfCookie(res, generateToken(24));
    const body: MeResponse = { user: { id: user.id, email: user.email, name: user.name, role: user.role }, permissions: permissionsList(user.role) };
    res.json(body);
  },

  async setupStatus(_req: Request, res: Response) {
    const required = await isSetupRequired();
    // Defaults for the setup form, as chosen when the instance was created.
    res.json(required ? { required, businessName: env.BUSINESS_NAME, timezone: env.BUSINESS_TIMEZONE } : { required });
  },

  /** First-run setup: creates the first administrator and signs them in. */
  async setup(req: Request, res: Response) {
    const input = parse(setupSchema, req.body);
    const { user, token } = await completeSetup(input, { ipAddress: req.ip ?? null, userAgent: req.get('user-agent') ?? null });
    setSessionCookie(res, token);
    setCsrfCookie(res, generateToken(24));
    const body: MeResponse = { user: { id: user.id, email: user.email, name: user.name, role: user.role }, permissions: permissionsList(user.role) };
    res.json(body);
  },

  async logout(req: Request, res: Response) {
    if (req.auth) {
      await destroySession(req.auth.sessionId);
      await audit({ action: 'auth.logout', actorId: req.auth.user.id, ipAddress: req.ip ?? null });
    }
    clearSessionCookie(res);
    res.status(204).end();
  },

  async me(req: Request, res: Response) {
    if (!req.auth) throw unauthorized();
    const body: MeResponse = { user: req.auth.user, permissions: [...req.auth.permissions] };
    res.json(body);
  },

  async forgot(req: Request, res: Response) {
    const { email } = parse(forgotPasswordSchema, req.body);
    staff.requestPasswordReset(email, req.ip ?? null);
    res.json({ message: 'If that address has an account, a reset link is on its way.' });
  },

  async reset(req: Request, res: Response) {
    const { token, password } = parse(resetPasswordSchema, req.body);
    await staff.resetPassword(token, password, req.ip ?? null);
    clearSessionCookie(res);
    res.json({ message: 'Password saved. You can now sign in.' });
  },

  async changePassword(req: Request, res: Response) {
    if (!req.auth) throw unauthorized();
    const input = parse(changePasswordSchema, req.body);
    await staff.changePassword(req.auth.user.id, req.auth.sessionId, input.currentPassword, input.newPassword, req.ip ?? null);
    res.json({ message: 'Password changed. Other devices have been signed out.' });
  },
};
