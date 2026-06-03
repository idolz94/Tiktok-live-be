import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler.js";
import { enqueueLiveEvent } from "../lib/queues.js";
import { ok } from "../lib/response.js";
import { broadcastSseToShop } from "../lib/sse-hub.js";
import { requireInternalApiKey } from "../middlewares/internal-api-key.js";
import { ingestCollectorComment } from "../services/internal-live-ingest.service.js";

const router = Router();

const ingestCommentSchema = z.object({
  eventId: z.string().min(1).optional(),
  eventType: z.string().optional().default("COMMENT"),
  source: z.string().optional().default("python-tiktok-collector"),

  shopId: z.string().optional().nullable(),
  liveUsername: z.string().min(1, "Thiếu liveUsername."),
  collectorSessionId: z.string().min(1, "Thiếu collectorSessionId."),
  liveSessionId: z.string().optional().nullable(),

  externalCommentId: z.string().optional(),
  dedupKey: z.string().optional(),
  tiktokUsername: z.string().optional(),
  displayName: z.string().optional(),
  avatarUrl: z.string().optional(),
  commentText: z.string().optional(),
  rawText: z.string().optional(),
  intent: z.string().optional().default("normal"),
  priorityLevel: z.string().optional().default("normal"),
  finalScore: z.number().optional().default(0),
  isOrderCreated: z.boolean().optional().default(false),
  createdAt: z.string().optional(),
  comment: z.any().optional(),
  rawPayload: z.any().optional(),
});

router.use(requireInternalApiKey);

router.post(
  "/ingest",
  asyncHandler(async (request, response) => {
    const body = ingestCommentSchema.parse(request.body || {});
    const createdAt = body.createdAt || new Date().toISOString();
    const externalCommentId = body.externalCommentId || body.comment?.id || body.comment?.externalCommentId || body.eventId;

    const normalizedComment = {
      ...(body.comment || {}),
      id: externalCommentId,
      externalCommentId,
      dedupKey: body.dedupKey || body.comment?.dedupKey || externalCommentId,
      tiktokUsername: body.tiktokUsername || body.comment?.tiktokUsername,
      displayName: body.displayName || body.comment?.displayName || body.comment?.username,
      username: body.displayName || body.comment?.username || body.comment?.displayName,
      avatarUrl: body.avatarUrl || body.comment?.avatarUrl,
      comment: body.commentText || body.comment?.comment || body.comment?.text,
      text: body.commentText || body.comment?.text || body.comment?.comment,
      rawText: body.rawText || body.comment?.rawText,
      tiktokLiveUsername: body.liveUsername,
      intent: body.intent || body.comment?.intent || "normal",
      priorityLevel: body.priorityLevel || body.comment?.priorityLevel || "normal",
      finalScore: body.finalScore ?? body.comment?.finalScore ?? 0,
      isOrderCreated: body.isOrderCreated ?? body.comment?.isOrderCreated ?? false,
      createdAt,
      rawPayload: body.rawPayload || body,
    };

    const result = await ingestCollectorComment({
      shopId: body.shopId,
      liveUsername: body.liveUsername,
      collectorSessionId: body.collectorSessionId,
      comment: normalizedComment,
      createdAt,
    });

    const ssePayload = {
      eventId: body.eventId || externalCommentId,
      eventType: "COMMENT",
      source: body.source,
      shopId: result.shop.id,
      liveSessionId: result.session.id,
      live_session_id: result.session.id,
      externalSessionId: result.session.external_session_id,
      collectorSessionId: body.collectorSessionId,
      liveUsername: body.liveUsername,
      comment: result.comment,
      createdAt: new Date().toISOString(),
    };

    const sseClientCount = broadcastSseToShop(result.shop.id, "COMMENT", ssePayload);

    await enqueueLiveEvent("collector-comment-ingested", {
      shopId: result.shop.id,
      liveSessionId: result.session.id,
      commentId: result.comment?.id,
      externalCommentId,
    });

    return ok(response, {
      accepted: true,
      sseClientCount,
      shopId: result.shop.id,
      liveSessionId: result.session.id,
      comment: result.comment,
    });
  }),
);

export default router;
