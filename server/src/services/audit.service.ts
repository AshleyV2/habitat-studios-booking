import type { Prisma } from '@prisma/client';
import { prisma, type Tx } from '../db/prisma';
import { logger } from '../utils/logger';

const SENSITIVE = /pass(word)?|secret|token|api[-_]?key|authorization|cookie|session|card|cvc|salt/i;

export function sanitise(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => sanitise(v, depth + 1));
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) if (!SENSITIVE.test(k)) out[k] = sanitise(v, depth + 1);
    return out;
  }
  if (typeof value === 'string' && value.length > 500) return `${value.slice(0, 500)}…`;
  return value;
}

export interface AuditEntry {
  action: string;
  actorId?: string | null;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
}

/** Record an administrative/security event. Pass `tx` to make it atomic with the change. */
export async function audit(entry: AuditEntry, tx?: Tx) {
  const data: Prisma.AuditLogUncheckedCreateInput = {
    action: entry.action,
    actorId: entry.actorId ?? null,
    targetType: entry.targetType ?? null,
    targetId: entry.targetId ?? null,
    metadata: entry.metadata ? (sanitise(entry.metadata) as Prisma.InputJsonValue) : undefined,
    ipAddress: entry.ipAddress ?? null,
  };
  if (tx) {
    await tx.auditLog.create({ data });
    return;
  }
  try {
    await prisma.auditLog.create({ data });
  } catch (err) {
    logger.error({ err, action: entry.action }, 'Failed to write audit log');
  }
}
