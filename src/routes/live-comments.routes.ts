import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler.js";
import { ok } from "../lib/response.js";
import { requireAuth } from "../middlewares/auth.js";
import { requireUsableAccountContext } from "../services/account.service.js";
import { saveLiveComment } from "../services/live-comments.service.js";
import { enqueueLiveEvent } from "../lib/queues.js";

const router = Router();

const saveCommentSchema = z.object({
  liveSessionId: z.string().min(1, "Thiếu liveSessionId."),
  comment: z.any().optional(),
  externalCommentId: z.string().optional(),
  tiktokUsername: z.string().optional(),
  displayName: z.string().optional(),
  avatarUrl: z.string().optional(),
  commentText: z.string().optional(),
  intent: z.string().optional(),
  priorityLevel: z.string().optional(),
  finalScore: z.number().optional(),
  isOrderCreated: z.boolean().optional(),
  orderId: z.string().nullish(),
});

router.post(
  "/",
  requireAuth,
  asyncHandler(async (request, response) => {
    const context = await requireUsableAccountContext(request);
    const body = saveCommentSchema.parse(request.body || {});
    const normalizedComment = {
      ...(body.comment || {}),
      id: body.comment?.id || body.externalCommentId,
      tiktokUsername: body.tiktokUsername,
      displayName: body.displayName,
      avatarUrl: body.avatarUrl,
      comment: body.commentText || body.comment?.comment || body.comment?.text,
      intent: body.intent || body.comment?.intent,
      priorityLevel: body.priorityLevel || body.comment?.priorityLevel,
      finalScore: body.finalScore ?? body.comment?.finalScore,
      isOrderCreated: body.isOrderCreated ?? body.comment?.isOrderCreated,
      orderId: body.orderId ?? body.comment?.orderId,
    };

    const comment = await saveLiveComment({
      shopId: context.shop.id,
      liveSessionId: body.liveSessionId,
      comment: normalizedComment,
    });

    await enqueueLiveEvent("comment-saved", {
      shopId: context.shop.id,
      liveSessionId: body.liveSessionId,
      commentId: comment?.id,
    });

    return ok(response, { comment });
  }),
);

export default router;
