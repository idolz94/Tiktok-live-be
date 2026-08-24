import { eq, and, desc } from "drizzle-orm";
import { db } from "../lib/db.js";
import { liveComments } from "../db/schema/index.js";
import { getCommentAvatar, getCommentDisplayName, getCommentText, hasNumber } from "../utils/comment.js";
import { getCommentTikTokUsername, normalizeAtUsername } from "../utils/tiktok.js";
import { updateLiveSessionCommentCount } from "./live-sessions.service.js";
import { scoreCommentForShop } from "./comment-scoring/index.js";
import logger from "../lib/logger.js";

export async function saveLiveComment({
  shopId,
  liveSessionId,
  comment,
  liveUsername,
}: {
  shopId: string;
  liveSessionId: string;
  comment: any;
  liveUsername?: string;
}) {
  if (!liveSessionId) return null;

  const commentText = getCommentText(comment);
  if (!commentText) return null;

  const externalCommentId = String(comment?.id || comment?.externalCommentId || comment?.external_comment_id || "").trim();
  if (!externalCommentId) return null;

  const tiktokUsername = normalizeAtUsername(getCommentTikTokUsername(comment));
  const normalizedLiveUser = liveUsername ? normalizeAtUsername(liveUsername) : "";
  const isHost = Boolean(normalizedLiveUser && tiktokUsername === normalizedLiveUser);

  const pipeline = await scoreCommentForShop(shopId, commentText, { isHost });

  // ponytail: dot1 gate — NEED_LLM only logged, no LLM call yet
  if (pipeline.verdict === "NEED_LLM") {
    logger.debug(
      { text: commentText.slice(0, 80), intent: pipeline.intent, missingFields: pipeline.missingFields },
      "[PIPELINE] NEED_LLM — queued for LLM phase 2",
    );
  }
  // ponytail: metric hook — count per verdict: pipeline_verdict_total{verdict}
  logger.debug({ verdict: pipeline.verdict, intent: pipeline.intent }, "[PIPELINE] verdict");

  const payload = {
    shopId,
    liveSessionId,
    externalCommentId,
    tiktokCommentId: externalCommentId,
    tiktokUsername,
    tiktokUniqueId: tiktokUsername.replace(/^@/, ""),
    displayName: getCommentDisplayName(comment),
    avatarUrl: getCommentAvatar(comment),
    commentText,
    text: commentText,
    rawText: String(comment?.rawText || comment?.raw_text || commentText).trim(),
    intent: pipeline.intent,
    priorityLevel: pipeline.priorityLevel,
    finalScore: pipeline.finalScore,
    hasNumber: hasNumber(commentText),
    canCreateOrder: pipeline.canCreateOrder,
    canSuggestOrder: pipeline.canSuggestOrder,
    canCreateDraftOrder: pipeline.canCreateDraftOrder,
    isPotentialBuyer: pipeline.isPotentialBuyer,
    isQuestion: pipeline.isQuestion,
    matchedReasons: pipeline.matchedReasons,
    ruleVersion: "comment-rules-v1",
    matchedProductCode: pipeline.matchedPresetCode,
    topic: pipeline.topic,
    confidence: pipeline.confidence,
    productReference: pipeline.productReference,
    isOrderCreated: Boolean(comment?.isOrderCreated || comment?.is_order_created),
    orderId: comment?.orderId || comment?.order_id || null,
    updatedAt: new Date(),
  };

  const [saved] = await db
    .insert(liveComments)
    .values(payload)
    .onConflictDoUpdate({
      target: [liveComments.liveSessionId, liveComments.externalCommentId],
      set: payload,
    })
    .returning();

  await updateLiveSessionCommentCount(liveSessionId);

  return saved;
}

export async function findDbLiveCommentId({
  shopId,
  liveSessionId,
  comment,
}: {
  shopId: string;
  liveSessionId?: string | null;
  comment: any;
}) {
  const commentRecord = comment as Record<string, any>;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;

  if (uuidRegex.test(String(commentRecord.dbId || ""))) return String(commentRecord.dbId);
  if (uuidRegex.test(String(commentRecord.liveCommentId || ""))) return String(commentRecord.liveCommentId);

  const externalCommentId = String(commentRecord.id || commentRecord.externalCommentId || "").trim();
  if (!externalCommentId) return null;

  // ponytail: external id can repeat across sessions, so scope by session when known.
  // Without a session id we fall back to the newest shop-scoped match.
  const rows = await db
    .select({ id: liveComments.id })
    .from(liveComments)
    .where(
      and(
        eq(liveComments.shopId, shopId),
        eq(liveComments.externalCommentId, externalCommentId),
        ...(liveSessionId ? [eq(liveComments.liveSessionId, liveSessionId)] : []),
      ),
    )
    .orderBy(desc(liveComments.createdAt))
    .limit(1);

  return rows[0]?.id ?? null;
}

export async function updateLiveCommentOrder({
  commentId,
  orderId,
  customerId,
}: {
  commentId?: string | null;
  orderId: string;
  customerId?: string | null;
}) {
  if (!commentId) return;

  await db
    .update(liveComments)
    .set({ isOrderCreated: true, orderId, customerId: customerId ?? null, updatedAt: new Date() })
    .where(eq(liveComments.id, commentId));
}

export async function getLiveSessionComments({
  shopId,
  liveSessionId,
  limit = 200,
}: {
  shopId: string;
  liveSessionId: string;
  limit?: number;
}) {
  return db
    .select()
    .from(liveComments)
    .where(and(eq(liveComments.shopId, shopId), eq(liveComments.liveSessionId, liveSessionId)))
    .orderBy(desc(liveComments.createdAt))
    .limit(limit);
}
