import type { staffCreateSchema, staffUpdateSchema, StaffUserDto } from '@habitat/shared';
import type { StaffUser } from '@prisma/client';
import type { z } from 'zod';
import { hashPassword, verifyAgainstDummy, verifyPassword } from '../auth/password';
import { createSession, destroyUserSessions } from '../auth/session.service';
import { consumeUserToken, issueUserToken } from '../auth/user-tokens';
import { publicLink } from '../config/env';
import { prisma } from '../db/prisma';
import { AppError, badRequest, conflict, notFound } from '../utils/errors';
import { logger } from '../utils/logger';
import { audit } from './audit.service';
import { enqueueEmail, flushOutboxSoon } from './email/outbox';
import { passwordResetEmail, staffInviteEmail } from './email/templates';
import { getSettings } from './settings.service';

export const toStaffDto = (u: StaffUser): StaffUserDto => ({
  id: u.id,
  email: u.email,
  name: u.name,
  role: u.role,
  disabled: u.disabledAt !== null,
  hasPassword: u.passwordHash !== null,
  lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
  createdAt: u.createdAt.toISOString(),
});

const INVALID = 'Incorrect email address or password.';

export async function login(email: string, password: string, meta: { ipAddress: string | null; userAgent: string | null }) {
  const user = await prisma.staffUser.findUnique({ where: { email } });
  if (!user?.passwordHash) {
    await verifyAgainstDummy(password);
    await audit({ action: 'auth.login_failed', metadata: { email }, ipAddress: meta.ipAddress });
    throw new AppError(401, 'invalid_credentials', INVALID);
  }
  if (!(await verifyPassword(user.passwordHash, password))) {
    await audit({ action: 'auth.login_failed', actorId: user.id, metadata: { email }, ipAddress: meta.ipAddress });
    throw new AppError(401, 'invalid_credentials', INVALID);
  }
  if (user.disabledAt) throw new AppError(403, 'account_disabled', 'This account has been disabled.');
  const token = await createSession(user.id, meta);
  await prisma.staffUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await audit({ action: 'auth.login', actorId: user.id, ipAddress: meta.ipAddress });
  return { user, token };
}

export function requestPasswordReset(email: string, ip: string | null) {
  void (async () => {
    const user = await prisma.staffUser.findUnique({ where: { email } });
    if (!user || user.disabledAt) return;
    const token = await issueUserToken(user.id, 'PASSWORD_RESET');
    await enqueueEmail(passwordResetEmail(user.email, user.name, token));
    await audit({ action: 'auth.password_reset_requested', actorId: user.id, ipAddress: ip });
    flushOutboxSoon();
  })().catch((err) => logger.error({ err }, 'Password reset request failed'));
}

export async function resetPassword(token: string, password: string, ip: string | null) {
  const claimed = await consumeUserToken(token, ['PASSWORD_RESET', 'INVITE']);
  if (!claimed) throw badRequest('This link is invalid or has expired.');
  await prisma.$transaction([
    prisma.staffUser.update({ where: { id: claimed.userId }, data: { passwordHash: await hashPassword(password) } }),
    prisma.userToken.updateMany({ where: { userId: claimed.userId, usedAt: null }, data: { usedAt: new Date() } }),
    prisma.session.deleteMany({ where: { userId: claimed.userId } }),
  ]);
  await audit({ action: claimed.type === 'INVITE' ? 'auth.invite_accepted' : 'auth.password_reset', actorId: claimed.userId, ipAddress: ip });
}

export async function changePassword(userId: string, sessionId: string, current: string, next: string, ip: string | null) {
  const user = await prisma.staffUser.findUniqueOrThrow({ where: { id: userId } });
  if (!user.passwordHash || !(await verifyPassword(user.passwordHash, current))) {
    throw new AppError(400, 'validation_error', 'Some fields need attention.', { currentPassword: 'Current password is incorrect' });
  }
  await prisma.staffUser.update({ where: { id: userId }, data: { passwordHash: await hashPassword(next) } });
  await destroyUserSessions(userId, sessionId);
  await audit({ action: 'auth.password_changed', actorId: userId, ipAddress: ip });
}

/**
 * Invite a staff member. The invitation is emailed AND returned once to the admin, so
 * an account can still be handed over in person if outgoing email isn't set up yet.
 */
export async function inviteStaff(input: z.output<typeof staffCreateSchema>, actorId: string, ip: string | null) {
  if (await prisma.staffUser.findUnique({ where: { email: input.email } })) throw conflict('A staff account with this email already exists.');
  const user = await prisma.staffUser.create({ data: { email: input.email, name: input.name, role: input.role } });
  const token = await issueUserToken(user.id, 'INVITE');
  const settings = await getSettings();
  await enqueueEmail(staffInviteEmail(user.email, user.name, token, settings.businessName));
  flushOutboxSoon();
  await audit({ action: 'staff.invited', actorId, targetType: 'staff', targetId: user.id, metadata: { email: user.email, role: user.role }, ipAddress: ip });
  return { user: toStaffDto(user), inviteLink: publicLink(`/admin/reset-password?token=${encodeURIComponent(token)}&invite=1`) };
}

export async function updateStaff(id: string, input: z.output<typeof staffUpdateSchema>, actorId: string, ip: string | null) {
  const user = await prisma.staffUser.findUnique({ where: { id } });
  if (!user) throw notFound('Staff member not found.');
  if (id === actorId && (input.disabled || input.role !== 'ADMIN')) throw badRequest('You cannot disable or demote your own account.');
  if (user.role === 'ADMIN' && (input.role !== 'ADMIN' || input.disabled)) {
    const admins = await prisma.staffUser.count({ where: { role: 'ADMIN', disabledAt: null, id: { not: id } } });
    if (admins === 0) throw badRequest('There must always be at least one active administrator.');
  }
  const updated = await prisma.staffUser.update({
    where: { id },
    data: { role: input.role, disabledAt: input.disabled ? (user.disabledAt ?? new Date()) : null },
  });
  if (input.disabled) await destroyUserSessions(id);
  await audit({ action: 'staff.updated', actorId, targetType: 'staff', targetId: id, metadata: { role: input.role, disabled: input.disabled }, ipAddress: ip });
  return toStaffDto(updated);
}

export { createSession };
