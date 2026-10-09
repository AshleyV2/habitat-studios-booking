import { ROLE_PERMISSIONS, type StaffRole } from '@habitat/shared';
import { env } from '../config/env';
import { prisma } from '../db/prisma';
import type { AuthContext } from '../types/express';
import { generateToken, hashToken } from '../utils/crypto';

const HOUR = 3600_000;
const TOUCH_INTERVAL_MS = 5 * 60_000;

export async function createSession(userId: string, meta: { ipAddress?: string | null; userAgent?: string | null }) {
  const token = generateToken();
  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + env.SESSION_TTL_HOURS * HOUR),
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent?.slice(0, 300) ?? null,
    },
  });
  return token;
}

export async function resolveSession(token: string): Promise<AuthContext | null> {
  const session = await prisma.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
  if (!session) return null;
  const now = Date.now();
  const idle = session.lastUsedAt.getTime() + env.SESSION_IDLE_HOURS * HOUR < now;
  if (session.expiresAt.getTime() <= now || idle || session.user.disabledAt) {
    await prisma.session.deleteMany({ where: { id: session.id } });
    return null;
  }
  if (now - session.lastUsedAt.getTime() > TOUCH_INTERVAL_MS) {
    await prisma.session.update({ where: { id: session.id }, data: { lastUsedAt: new Date() } });
  }
  const u = session.user;
  return {
    sessionId: session.id,
    user: { id: u.id, email: u.email, name: u.name, role: u.role as StaffRole },
    permissions: ROLE_PERMISSIONS[u.role as StaffRole],
  };
}

export async function destroySession(id: string) {
  await prisma.session.deleteMany({ where: { id } });
}

export async function destroyUserSessions(userId: string, exceptId?: string) {
  const r = await prisma.session.deleteMany({ where: { userId, ...(exceptId ? { id: { not: exceptId } } : {}) } });
  return r.count;
}

export async function purgeExpiredSessions() {
  const r = await prisma.session.deleteMany({
    where: { OR: [{ expiresAt: { lt: new Date() } }, { lastUsedAt: { lt: new Date(Date.now() - env.SESSION_IDLE_HOURS * HOUR) } }] },
  });
  return r.count;
}
