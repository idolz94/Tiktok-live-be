import { and, count, desc, eq } from "drizzle-orm";
import { db } from "../lib/db.js";
import { adminAuditLogs, users } from "../db/schema/index.js";

export type AuditLogBefore = unknown;
export type AuditLogAfter = unknown;
export type AuditLogMetadata = unknown;

export type CreateAuditLogInput = {
  adminUserId: string;
  action: string;
  targetType: string;
  targetId: string;
  before?: AuditLogBefore;
  after?: AuditLogAfter;
  metadata?: AuditLogMetadata;
  ip?: string | null;
  userAgent?: string | null;
};

/**
 * Insert one admin audit log row and return the stored record.
 *
 * Database insertion failures are intentionally not caught; they propagate
 * to the caller so audit persistence can be enforced before an admin action
 * is reported as successful.
 */
export async function createAuditLog(input: CreateAuditLogInput) {
  const [row] = await db
    .insert(adminAuditLogs)
    .values({
      adminUserId: input.adminUserId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      before: input.before,
      after: input.after,
      metadata: input.metadata,
      ip: input.ip,
      userAgent: input.userAgent,
    })
    .returning();

  return row;
}

// ─── Per-target audit log query ──────────────────────────────────────────────

export async function getTargetAuditLogs(
  targetType: string,
  targetId: string,
  page: number = 1,
  limit: number = 20,
) {
  const limitCapped = Math.min(limit, 100);
  const offset = (page - 1) * limitCapped;

  const where = and(
    eq(adminAuditLogs.targetType, targetType),
    eq(adminAuditLogs.targetId, targetId),
  );

  const [{ total }] = await db
    .select({ total: count() })
    .from(adminAuditLogs)
    .where(where);

  const logs = total === 0
    ? []
    : await db
        .select({
          id: adminAuditLogs.id,
          action: adminAuditLogs.action,
          adminUserId: adminAuditLogs.adminUserId,
          adminUsername: users.username,
          targetType: adminAuditLogs.targetType,
          targetId: adminAuditLogs.targetId,
          before: adminAuditLogs.before,
          after: adminAuditLogs.after,
          metadata: adminAuditLogs.metadata,
          ip: adminAuditLogs.ip,
          userAgent: adminAuditLogs.userAgent,
          createdAt: adminAuditLogs.createdAt,
        })
        .from(adminAuditLogs)
        .leftJoin(users, eq(users.id, adminAuditLogs.adminUserId))
        .where(where)
        .orderBy(desc(adminAuditLogs.createdAt))
        .limit(limitCapped)
        .offset(offset);

  const result = logs.map((row) => ({
    id: row.id,
    action: row.action,
    adminUser: {
      id: row.adminUserId,
      username: row.adminUsername,
    },
    targetType: row.targetType,
    targetId: row.targetId,
    before: row.before,
    after: row.after,
    metadata: row.metadata,
    ip: row.ip,
    userAgent: row.userAgent,
    createdAt: row.createdAt,
  }));

  return { logs: result, total, page, limit: limitCapped };
}

/** Backwards-compatible wrapper for per-user audit logs. */
export async function getUserAuditLogs(
  userId: string,
  page: number = 1,
  limit: number = 20,
) {
  return getTargetAuditLogs("user", userId, page, limit);
}
