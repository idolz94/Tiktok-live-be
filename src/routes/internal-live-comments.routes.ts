import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler.js";
import { enqueueLiveEvent } from "../lib/queues.js";
import { ok } from "../lib/response.js";
import { broadcastSseToShop } from "../lib/sse-hub.js";
import { requireInternalApiKey } from "../middlewares/internal-api-key.js";
import {
  ensureCollectorLiveSession,
  resolveShopForCollectorEvent,
} from "../services/internal-live-ingest.service.js";
import { saveLiveComment } from "../services/live-comments.service.js";

const router = Router();

const ingestCommentSchema = z.object({
  eventId: z.string().optional().nullable(),
  eventType: z.string().optional().nullable(),
  source: z.string().optional().nullable(),

  shopId: z.string().optional().nullable(),
  liveUsername: z.string().min(1, "Thiếu liveUsername."),
  liveSessionId: z.string().optional().nullable(),
  collectorSessionId: z.string().min(1, "Thiếu collectorSessionId."),

  externalCommentId: z.string().optional().nullable(),
  dedupKey: z.string().optional().nullable(),

  tiktokUsername: z.string().optional().nullable(),
  displayName: z.string().optional().nullable(),
  avatarUrl: z.string().optional().nullable(),
  commentText: z.string().optional().nullable(),
  rawText: z.string().optional().nullable(),

  intent: z.string().optional().nullable(),
  priorityLevel: z.string().optional().nullable(),
  finalScore: z.number().optional().nullable(),
  isOrderCreated: z.boolean().optional().nullable(),

  createdAt: z.string().optional().nullable(),

  comment: z.any().optional(),
  rawPayload: z.any().optional(),
});

router.use(requireInternalApiKey);

router.post(
  "/ingest",
  asyncHandler(async (request, response) => {
    const body = ingestCommentSchema.parse(request.body || {});
    const createdAt = body.createdAt || new Date().toISOString();

    const shop = await resolveShopForCollectorEvent({
      shopId: body.shopId,
      liveUsername: body.liveUsername,
    });

    if (!shop?.id) {
      return ok(response, {
        accepted: false,
        ignored: true,
        reason: `Không tìm thấy shop cho TikTok username ${body.liveUsername}.`,
      });
    }

    const session = await ensureCollectorLiveSession({
      shopId: shop.id,
      liveUsername: body.liveUsername,
      collectorSessionId: body.collectorSessionId,
      startedAt: createdAt,
    });

    const normalizedComment = {
      ...(body.comment || {}),

      id:
        body.comment?.id ||
        body.externalCommentId ||
        body.eventId,

      externalCommentId:
        body.externalCommentId ||
        body.comment?.externalCommentId ||
        body.comment?.external_comment_id ||
        body.comment?.id ||
        body.eventId,

      dedupKey:
        body.dedupKey ||
        body.comment?.dedupKey ||
        body.eventId,

      shopId: shop.id,
      liveSessionId: session.id,

      tiktokUsername:
        body.tiktokUsername ||
        body.comment?.tiktokUsername ||
        body.comment?.tiktok_username,

      displayName:
        body.displayName ||
        body.comment?.displayName ||
        body.comment?.display_name ||
        body.comment?.username,

      avatarUrl:
        body.avatarUrl ||
        body.comment?.avatarUrl ||
        body.comment?.avatar_url ||
        body.comment?.avatar,

      commentText:
        body.commentText ||
        body.comment?.commentText ||
        body.comment?.comment_text ||
        body.comment?.text ||
        body.comment?.comment,

      text:
        body.commentText ||
        body.comment?.text ||
        body.comment?.commentText ||
        body.comment?.comment,

      rawText:
        body.rawText ||
        body.comment?.rawText ||
        body.comment?.raw_text,

      intent:
        body.intent ||
        body.comment?.intent ||
        "normal",

      priorityLevel:
        body.priorityLevel ||
        body.comment?.priorityLevel ||
        body.comment?.priority_level ||
        "normal",

      finalScore:
        body.finalScore ??
        body.comment?.finalScore ??
        body.comment?.final_score ??
        0,

      isOrderCreated:
        body.isOrderCreated ??
        body.comment?.isOrderCreated ??
        body.comment?.is_order_created ??
        false,

      createdAt,
      created_at: createdAt,

      rawPayload: body.rawPayload || body.comment?.rawPayload || body,
    };

    const comment = await saveLiveComment({
      shopId: shop.id,
      liveSessionId: session.id,
      comment: normalizedComment,
    });

    if (!comment) {
      return ok(response, {
        accepted: false,
        ignored: true,
        reason: "Comment rỗng hoặc thiếu externalCommentId/liveSessionId.",
      });
    }

    const payload = {
      eventId: body.eventId || body.dedupKey || comment.externalCommentId || comment.id,
      eventType: "COMMENT",
      source: "node-live-ingest",

      shopId: shop.id,

      liveSessionId: session.id,
      live_session_id: session.id,

      externalSessionId: body.collectorSessionId,
      collectorSessionId: body.collectorSessionId,

      liveUsername: body.liveUsername,

      comment,

      createdAt,
    };

    const sseClientCount = broadcastSseToShop(shop.id, "COMMENT", payload);

    await enqueueLiveEvent("comment-saved", {
      shopId: shop.id,
      liveSessionId: session.id,
      commentId: comment.id,
      externalCommentId: comment.externalCommentId,
      sseClientCount,
    });

    return ok(response, {
      accepted: true,
      sseClientCount,
      session,
      comment,
    });
  }),
);

export default router;