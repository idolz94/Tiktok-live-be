import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler.js";
import { ok } from "../lib/response.js";
import { broadcastSseToShop } from "../lib/sse-hub.js";
import { requireAuth } from "../middlewares/auth.js";
import { requireUsableAccountContext } from "../services/account.service.js";
import {
  listBuyingIntentQueue,
  updateBuyingIntentQueueStatus,
} from "../services/buying-intent-queue.service.js";
import { analyzeLiveCommentIntent } from "../services/comment-scoring/index.js";

const router = Router();

const listQuerySchema = z.object({
  liveSessionId: z.string().optional(),
});

const classifyBodySchema = z.object({
  comment: z.string().trim().min(1),
});

const updateStatusSchema = z.object({
  status: z.enum(["pending", "handled", "ignored"]),
});

const paramsSchema = z.object({
  itemId: z.string(),
});

router.post(
  "/classify",
  requireAuth,
  asyncHandler(async (request, response) => {
    const context = await requireUsableAccountContext(request);
    void context;
    const body = classifyBodySchema.parse(request.body || {});
    const classification = analyzeLiveCommentIntent(body.comment);

    return ok(response, { classification });
  }),
);

router.get(
  "/",
  requireAuth,
  asyncHandler(async (request, response) => {
    const context = await requireUsableAccountContext(request);
    const query = listQuerySchema.parse(request.query || {});
    const items = await listBuyingIntentQueue({
      shopId: context.shop.id,
      liveSessionId: query.liveSessionId,
    });

    return ok(response, { items });
  }),
);

router.patch(
  "/:itemId/status",
  requireAuth,
  asyncHandler(async (request, response) => {
    const context = await requireUsableAccountContext(request);
    const body = updateStatusSchema.parse(request.body || {});
    const params = paramsSchema.parse(request.params || {});
    const item = await updateBuyingIntentQueueStatus({
      shopId: context.shop.id,
      itemId: params.itemId,
      status: body.status,
    });

    broadcastSseToShop(context.shop.id, "BUYING_INTENT_UPDATED", { item });

    return ok(response, { item });
  }),
);

export default router;
