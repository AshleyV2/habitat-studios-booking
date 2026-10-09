import type { UserTokenType } from '@prisma/client';
import { prisma } from '../db/prisma';
import { generateToken, hashToken } from '../utils/crypto';

const TTL_MS: Record<UserTokenType, number> = {
  PASSWORD_RESET: 60 * 60 * 1000,
  INVITE: 7 * 24 * 3600 * 1000,
};

/** Issue a single-use token. Any earlier unused token of the same type is invalidated. */
export async function issueUserToken(userId: string, type: UserTokenType): Promise<string> {
  const token = generateToken();
  await prisma.$transaction([
    prisma.userToken.updateMany({
      where: { userId, type, usedAt: null },
      data: { usedAt: new Date() },
    }),
    prisma.userToken.create({
      data: {
        userId,
        type,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + TTL_MS[type]),
      },
    }),
  ]);
  return token;
}

/**
 * Atomically consume a token. Returns the user id, or null if the token is unknown,
 * of the wrong type, expired or already used.
 */
export async function consumeUserToken(
  token: string,
  types: UserTokenType[],
): Promise<{ userId: string; type: UserTokenType } | null> {
  const record = await prisma.userToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!record || !types.includes(record.type)) return null;
  if (record.usedAt || record.expiresAt.getTime() <= Date.now()) return null;

  // Conditional update guards against the same token being redeemed twice concurrently.
  const claimed = await prisma.userToken.updateMany({
    where: { id: record.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (claimed.count !== 1) return null;
  return { userId: record.userId, type: record.type };
}
