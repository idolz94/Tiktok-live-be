import { eq, and, sql } from "drizzle-orm";
import { db } from "../lib/db.js";
import { liveSessions, liveComments } from "../db/schema/index.js";
import { calcDurationSeconds, nowIso } from "../utils/date.js";
import { isUuid } from "../utils/id.js";
import { normalizeAtUsername } from "../utils/tiktok.js";

export async function findLiveSessionByExternalId({
  shopId,
  sessionId,
}: {
  shopId: string;
  sessionId: string;
}) {
  const rows = await db
    .select()
    .from(liveSessions)
    .where(and(eq(liveSessions.shopId, shopId), eq(liveSessions.externalSessionId, sessionId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function startLiveSession({
  shopId,
  userId,
  sessionId,
  username,
  startedAt,
}: {
  shopId: string;
  userId: string;
  sessionId: string;
  username: string;
  startedAt: string;
}) {
  const externalSessionId = String(sessionId || "").trim();
  if (!externalSessionId) throw new Error("Thiếu sessionId.");

  const existed = await findLiveSessionByExternalId({ shopId, sessionId: externalSessionId });

  if (existed) {
    const [updated] = await db
      .update(liveSessions)
      .set({
        tiktokUsername: normalizeAtUsername(username),
        startedAt: new Date(startedAt),
        status: "running",
        endedAt: null,
        endReason: null,
        updatedAt: new Date(),
      })
      .where(eq(liveSessions.id, existed.id))
      .returning();
    return updated;
  }

  const [created] = await db
    .insert(liveSessions)
    .values({
      shopId,
      createdBy: userId,
      externalSessionId,
      tiktokUsername: normalizeAtUsername(username),
      startedAt: new Date(startedAt),
      status: "running",
      commentCount: 0,
      orderCount: 0,
      customerCount: 0,
      durationSeconds: 0,
    })
    .returning();
  return created;
}

export async function endLiveSession({
  shopId,
  userId,
  sessionId,
  username,
  startedAt,
  endedAt,
  durationSeconds,
  commentCount,
  reason = "live_ended",
}: {
  shopId: string;
  userId: string;
  sessionId: string;
  username: string;
  startedAt?: string | null;
  endedAt: string;
  durationSeconds?: number;
  commentCount?: number;
  reason?: string;
}) {
  const externalSessionId = String(sessionId || "").trim();
  if (!externalSessionId) throw new Error("Thiếu sessionId.");

  const normalizedUsername = normalizeAtUsername(username);
  const now = new Date();

  let existed = await findLiveSessionByExternalId({ shopId, sessionId: externalSessionId });

  if (!existed && isUuid(externalSessionId)) {
    const rows = await db
      .select()
      .from(liveSessions)
      .where(and(eq(liveSessions.shopId, shopId), eq(liveSessions.id, externalSessionId)))
      .limit(1);
    existed = rows[0] ?? null;
  }

  if (!existed && normalizedUsername) {
    const rows = await db
      .select()
      .from(liveSessions)
      .where(
        and(
          eq(liveSessions.shopId, shopId),
          eq(liveSessions.tiktokUsername, normalizedUsername),
          eq(liveSessions.status, "running"),
        ),
      )
      .orderBy(liveSessions.startedAt)
      .limit(1);
    existed = rows[0] ?? null;
  }

  const finalStartedAt = startedAt || existed?.startedAt?.toISOString() || now.toISOString();
  const finalDurationSeconds =
    typeof durationSeconds === "number"
      ? durationSeconds
      : calcDurationSeconds(finalStartedAt, endedAt);

  let finalCommentCount = commentCount;
  if (typeof finalCommentCount !== "number" && existed?.id) {
    const result = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(liveComments)
      .where(and(eq(liveComments.shopId, shopId), eq(liveComments.liveSessionId, existed.id)));
    finalCommentCount = result[0]?.count ?? 0;
  }
  if (typeof finalCommentCount !== "number") {
    finalCommentCount = existed?.commentCount ?? 0;
  }

  const status = reason === "live_error" ? "error" : "ended";

  if (existed) {
    const [updated] = await db
      .update(liveSessions)
      .set({
        tiktokUsername: normalizedUsername,
        startedAt: new Date(finalStartedAt),
        endedAt: new Date(endedAt),
        durationSeconds: finalDurationSeconds,
        commentCount: finalCommentCount,
        status,
        endReason: reason,
        updatedAt: now,
      })
      .where(eq(liveSessions.id, existed.id))
      .returning();
    return updated;
  }

  const [created] = await db
    .insert(liveSessions)
    .values({
      shopId,
      createdBy: userId,
      externalSessionId,
      tiktokUsername: normalizedUsername,
      startedAt: new Date(finalStartedAt),
      endedAt: new Date(endedAt),
      durationSeconds: finalDurationSeconds,
      commentCount: finalCommentCount,
      orderCount: 0,
      customerCount: 0,
      status,
      endReason: reason,
    })
    .returning();
  return created;
}

export async function updateLiveSessionOrderCount(liveSessionId?: string | null) {
  if (!isUuid(liveSessionId)) return;

  const rows = await db
    .select({ orderCount: liveSessions.orderCount })
    .from(liveSessions)
    .where(eq(liveSessions.id, liveSessionId as string))
    .limit(1);

  const session = rows[0];
  if (!session) return;

  await db
    .update(liveSessions)
    .set({ orderCount: (session.orderCount ?? 0) + 1, updatedAt: new Date() })
    .where(eq(liveSessions.id, liveSessionId as string));
}

export async function updateLiveSessionCommentCount(liveSessionId: string) {
  if (!liveSessionId) return;

  const countResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(liveComments)
    .where(eq(liveComments.liveSessionId, liveSessionId));
  const commentCount = countResult[0]?.count ?? 0;

  const sessionRows = await db
    .select({ startedAt: liveSessions.startedAt, endedAt: liveSessions.endedAt })
    .from(liveSessions)
    .where(eq(liveSessions.id, liveSessionId))
    .limit(1);

  const session = sessionRows[0];
  const now = nowIso();
  const durationSeconds = calcDurationSeconds(
    session?.startedAt?.toISOString(),
    session?.endedAt?.toISOString() ?? now,
  );

  await db
    .update(liveSessions)
    .set({ commentCount, durationSeconds, updatedAt: new Date() })
    .where(eq(liveSessions.id, liveSessionId));
}

export async function getOrCreateRunningLiveSession({
  shopId,
  tiktokUsername,
  externalSessionId,
  startedAt,
}: {
  shopId: string;
  tiktokUsername: string;
  externalSessionId?: string | null;
  startedAt?: string | null;
}) {
  const normalizedUsername = String(tiktokUsername || "").trim();

  if (externalSessionId) {
    const rows = await db
      .select()
      .from(liveSessions)
      .where(and(eq(liveSessions.shopId, shopId), eq(liveSessions.externalSessionId, externalSessionId)))
      .limit(1);
    if (rows[0]) return rows[0];
  }

  const runningRows = await db
    .select()
    .from(liveSessions)
    .where(
      and(
        eq(liveSessions.shopId, shopId),
        eq(liveSessions.tiktokUsername, normalizedUsername),
        eq(liveSessions.status, "running"),
      ),
    )
    .orderBy(liveSessions.startedAt)
    .limit(1);

  if (runningRows[0]) return runningRows[0];

  const [created] = await db
    .insert(liveSessions)
    .values({
      shopId,
      tiktokUsername: normalizedUsername,
      externalSessionId: externalSessionId ?? crypto.randomUUID(),
      startedAt: startedAt ? new Date(startedAt) : new Date(),
      status: "running",
      commentCount: 0,
      orderCount: 0,
      durationSeconds: 0,
    })
    .returning();
  return created;
}

export async function endRunningLiveSession({
  shopId,
  tiktokUsername,
  liveSessionId,
  externalSessionId,
  reason = "manual_stop",
  endedAt,
}: {
  shopId: string;
  tiktokUsername?: string | null;
  liveSessionId?: string | null;
  externalSessionId?: string | null;
  reason?: string;
  endedAt?: string | null;
}) {
  const finalEndedAt = endedAt || nowIso();
  const normalizedUsername = normalizeAtUsername(tiktokUsername);

  let session: typeof liveSessions.$inferSelect | null;

  if (liveSessionId) {    const rows = await db
      .select()
      .from(liveSessions)
      .where(and(eq(liveSessions.id, liveSessionId), eq(liveSessions.shopId, shopId)))
      .limit(1);
    session = rows[0] ?? null;
  } else if (externalSessionId) {
    const rows = await db
      .select()
      .from(liveSessions)
      .where(and(eq(liveSessions.externalSessionId, externalSessionId), eq(liveSessions.shopId, shopId)))
      .limit(1);
    session = rows[0] ?? null;
  } else if (normalizedUsername) {
    const rows = await db
      .select()
      .from(liveSessions)
      .where(
        and(
          eq(liveSessions.shopId, shopId),
          eq(liveSessions.tiktokUsername, normalizedUsername),
          eq(liveSessions.status, "running"),
        ),
      )
      .orderBy(liveSessions.startedAt)
      .limit(1);
    session = rows[0] ?? null;
  } else {
    const rows = await db
      .select()
      .from(liveSessions)
      .where(and(eq(liveSessions.shopId, shopId), eq(liveSessions.status, "running")))
      .orderBy(liveSessions.startedAt)
      .limit(1);
    session = rows[0] ?? null;
  }

  if (!session && normalizedUsername && !liveSessionId && !externalSessionId) {
    const rows = await db
      .select()
      .from(liveSessions)
      .where(and(eq(liveSessions.shopId, shopId), eq(liveSessions.status, "running")))
      .orderBy(liveSessions.startedAt)
      .limit(1);
    session = rows[0] ?? null;
  }

  if (!session) return null;

  const durationSeconds = calcDurationSeconds(session.startedAt?.toISOString(), finalEndedAt);

  const [updated] = await db
    .update(liveSessions)
    .set({
      endedAt: new Date(finalEndedAt),
      durationSeconds,
      endReason: reason,
      status: "ended",
      updatedAt: new Date(),
    })
    .where(eq(liveSessions.id, session.id))
    .returning();

  return updated;
}

export function mapLiveSession(row: any) {
  return {
    ...row,
    started_at: row.started_at,
    ended_at: row.ended_at,
    duration_seconds: row.duration_seconds || 0,
    comment_count: row.comment_count || 0,
    order_count: row.order_count || 0,
    id: row.id,
    shopId: row.shop_id,
    externalSessionId: row.external_session_id,
    tiktokUsername: row.tiktok_username,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    durationSeconds: row.duration_seconds || 0,
    commentCount: row.comment_count || 0,
    orderCount: row.order_count || 0,
    endReason: row.end_reason,
    status: row.status,
  };
}

export async function getLiveSessionHistory({ shopId, limit = 100 }: { shopId: string; limit?: number }) {
  return db
    .select()
    .from(liveSessions)
    .where(eq(liveSessions.shopId, shopId))
    .orderBy(liveSessions.startedAt)
    .limit(limit);
}

export async function getRunningLiveSession({ shopId }: { shopId: string }) {
  const rows = await db
    .select()
    .from(liveSessions)
    .where(and(eq(liveSessions.shopId, shopId), eq(liveSessions.status, "running")))
    .orderBy(liveSessions.startedAt)
    .limit(1);
  return rows[0] ?? null;
}
