import { eq, and } from "drizzle-orm";
import { db } from "../lib/db.js";
import { liveComments } from "../db/schema/index.js";
import { getCommentAvatar, getCommentDisplayName, getCommentText, hasNumber } from "../utils/comment.js";
import { getCommentTikTokUsername, normalizeAtUsername } from "../utils/tiktok.js";
import { analyzeLiveCommentIntent } from "../utils/comment-intent.js";
import { matchPresetByComment } from "./product-presets.service.js";
import { updateLiveSessionCommentCount } from "./live-sessions.service.js";

export async function saveLiveComment({
  shopId,
  liveSessionId,
  comment,
}: {
  shopId: string;
  liveSessionId: string;
  comment: any;
}) {
  if (!liveSessionId) return null;

  const commentText = getCommentText(comment);
  if (!commentText) return null;

  const externalCommentId = String(comment?.id || comment?.externalCommentId || comment?.external_comment_id || "").trim();
  if (!externalCommentId) return null;

  const tiktokUsername = normalizeAtUsername(getCommentTikTokUsername(comment));
  const intentResult = analyzeLiveCommentIntent(commentText);

  const matchedPreset = await matchPresetByComment(shopId, commentText);
  if (matchedPreset) {
    intentResult.intent = "buy";
    intentResult.priorityLevel = "high";
    intentResult.finalScore = 90;
    intentResult.canCreateOrder = true;
    intentResult.isPotentialBuyer = true;
  }

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
    intent: intentResult.intent,
    priorityLevel: intentResult.priorityLevel,
    finalScore: intentResult.finalScore,
    hasNumber: hasNumber(commentText),
    canCreateOrder: intentResult.canCreateOrder,
    isOrderCreated: Boolean(comment?.isOrderCreated || comment?.is_order_created),
    orderId: comment?.orderId || comment?.order_id || null,
    updatedAt: new Date(),
  };

  const [saved] = await db
    .insert(liveComments)
    .values(payload)
    .onConflictDoUpdate({
      target: [liveComments.shopId, liveComments.externalCommentId],
      set: payload,
    })
    .returning();

  await updateLiveSessionCommentCount(liveSessionId);

  return saved;
}

export async function findDbLiveCommentId({
  shopId,
  comment,
}: {
  shopId: string;
  comment: any;
}) {
  const commentRecord = comment as Record<string, any>;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;

  if (uuidRegex.test(String(commentRecord.dbId || ""))) return String(commentRecord.dbId);
  if (uuidRegex.test(String(commentRecord.liveCommentId || ""))) return String(commentRecord.liveCommentId);

  const externalCommentId = String(commentRecord.id || commentRecord.externalCommentId || "").trim();
  if (!externalCommentId) return null;

  const rows = await db
    .select({ id: liveComments.id })
    .from(liveComments)
    .where(and(eq(liveComments.shopId, shopId), eq(liveComments.externalCommentId, externalCommentId)))
    .limit(1);

  return rows[0]?.id ?? null;
}

export async function updateLiveCommentOrder({
  commentId,
  orderId,
}: {
  commentId?: string | null;
  orderId: string;
}) {
  if (!commentId) return;

  await db
    .update(liveComments)
    .set({ isOrderCreated: true, orderId, updatedAt: new Date() })
    .where(eq(liveComments.id, commentId));
}
