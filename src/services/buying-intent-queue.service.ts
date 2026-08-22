import { and, desc, eq, sql } from "drizzle-orm";
import { buyingIntentQueue, liveComments } from "../db/schema/index.js";
import { badRequest, notFound } from "../lib/api-error.js";
import { db } from "../lib/db.js";
import { normalizeAtUsername } from "../utils/tiktok.js";
import { analyzeLiveCommentIntent } from "../utils/comment-intent.js";
import { getRunningLiveSession } from "./live-sessions.service.js";

type QueueStatus = "pending" | "handled" | "ignored";

// ponytail: already_ordered excluded — customers who already bought aren't active buying opportunities
const ACTIVE_INTENTS = new Set(["buy", "ask_price", "ask_stock", "ask_shipping", "ask_product", "ask_product_demo", "ask_how_to_buy"]);

function isQueueWorthComment(comment: typeof liveComments.$inferSelect) {
  return Boolean(comment.isPotentialBuyer || comment.canSuggestOrder || ACTIVE_INTENTS.has(String(comment.intent || "")));
}

function normalizeStatus(status: string): QueueStatus {
  if (status === "pending" || status === "handled" || status === "ignored") return status;
  throw badRequest("Trạng thái queue không hợp lệ.");
}

export async function upsertBuyingIntentQueueFromComment(comment: typeof liveComments.$inferSelect) {
  if (!comment.liveSessionId || !comment.tiktokUsername || !isQueueWorthComment(comment)) return null;

  const now = new Date();
  const username = normalizeAtUsername(comment.tiktokUsername);

  // ponytail: re-parse latest comment for structured data — comment row may not carry parsed fields yet
  const commentText = comment.commentText || comment.text || "";
  const analysis = analyzeLiveCommentIntent(commentText);
  const parsedData = analysis.parsedData ?? { productCode: null, color: null, size: null, quantity: null };
  const missingFields = analysis.missingFields ?? [];
  const suggestedReply = analysis.suggestedReply ?? "";
  const canCreateDraftOrder = analysis.canCreateDraftOrder;

  const payload = {
    shopId: comment.shopId,
    liveSessionId: comment.liveSessionId,
    tiktokUsername: username,
    displayName: comment.displayName,
    avatarUrl: comment.avatarUrl,
    intent: comment.intent || "normal",
    priorityLevel: comment.priorityLevel || "normal",
    finalScore: comment.finalScore ?? 0,
    latestCommentId: comment.id,
    latestCommentText: commentText,
    latestCommentAt: comment.createdAt ?? now,
    parsedData,
    suggestedReply,
    missingFields,
    canCreateDraftOrder,
    status: "pending",
    handledAt: null,
    updatedAt: now,
  };

  const [item] = await db
    .insert(buyingIntentQueue)
    .values({ ...payload, commentCount: 1 })
    .onConflictDoUpdate({
      target: [buyingIntentQueue.liveSessionId, buyingIntentQueue.tiktokUsername],
      set: {
        ...payload,
        commentCount: sql`${buyingIntentQueue.commentCount} + 1`,
      },
    })
    .returning();

  return item;
}

export async function listBuyingIntentQueue({
  shopId,
  liveSessionId,
}: {
  shopId: string;
  liveSessionId?: string | null;
}) {
  const sessionId = liveSessionId || (await getRunningLiveSession({ shopId }))?.id;
  if (!sessionId) return [];

  return db
    .select()
    .from(buyingIntentQueue)
    .where(and(eq(buyingIntentQueue.shopId, shopId), eq(buyingIntentQueue.liveSessionId, sessionId)))
    .orderBy(desc(buyingIntentQueue.updatedAt))
    .limit(100);
}

export async function updateBuyingIntentQueueStatus({
  shopId,
  itemId,
  status,
}: {
  shopId: string;
  itemId: string;
  status: string;
}) {
  const normalizedStatus = normalizeStatus(status);
  const now = new Date();
  const [item] = await db
    .update(buyingIntentQueue)
    .set({
      status: normalizedStatus,
      handledAt: normalizedStatus === "pending" ? null : now,
      updatedAt: now,
    })
    .where(and(eq(buyingIntentQueue.shopId, shopId), eq(buyingIntentQueue.id, itemId)))
    .returning();

  if (!item) throw notFound("Không tìm thấy khách trong queue.");
  return item;
}
