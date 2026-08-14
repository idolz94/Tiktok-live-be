import { db } from "../lib/db.js";
import { adminAuditLogs } from "../db/schema/index.js";

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
