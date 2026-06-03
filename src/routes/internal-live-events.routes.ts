import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler.js";
import { enqueueLiveEvent } from "../lib/queues.js";
import { ok } from "../lib/response.js";
import { broadcastSseToShop } from "../lib/sse-hub.js";
import { requireInternalApiKey } from "../middlewares/internal-api-key.js";
import {
  ensureCollectorLiveSession,
  findShopOwnerUserId,
  resolveShopForCollectorEvent,
} from "../services/internal-live-ingest.service.js";
import { endLiveSession } from "../services/live-sessions.service.js";

const router = Router();

const eventSchema = z.object({
  shopId: z.string().optional().nullable(),
  liveUsername: z.string().min(1, "Thiếu liveUsername."),
  collectorSessionId: z.string().min(1, "Thiếu collectorSessionId."),
  roomId: z.string().optional().nullable(),
  message: z.string().optional(),
  reason: z.string().optional(),
  shouldStop: z.boolean().optional(),
  retry: z.boolean().optional(),
  startedAt: z.string().optional(),
  endedAt: z.string().optional(),
  commentCount: z.number().optional(),
  createdAt: z.string().optional(),
});

router.use(requireInternalApiKey);

router.post(
  "/connected",
  asyncHandler(async (request, response) => {
    const body = eventSchema.parse(request.body || {});
    const createdAt = body.createdAt || body.startedAt || new Date().toISOString();
    const shop = await resolveShopForCollectorEvent({ shopId: body.shopId, liveUsername: body.liveUsername });
    if (!shop?.id) throw new Error(`Không tìm thấy shop cho TikTok username ${body.liveUsername}.`);

    const session = await ensureCollectorLiveSession({
      shopId: shop.id,
      liveUsername: body.liveUsername,
      collectorSessionId: body.collectorSessionId,
      startedAt: createdAt,
    });

    const payload = {
      shopId: shop.id,
      liveSessionId: session.id,
      live_session_id: session.id,
      collectorSessionId: body.collectorSessionId,
      liveUsername: body.liveUsername,
      roomId: body.roomId,
      createdAt,
    };

    const sseClientCount = broadcastSseToShop(shop.id, "LIVE_CONNECTED", payload);
    await enqueueLiveEvent("collector-live-connected", payload);

    return ok(response, { accepted: true, sseClientCount, session });
  }),
);

router.post(
  "/disconnected",
  asyncHandler(async (request, response) => {
    const body = eventSchema.parse(request.body || {});
    const endedAt = body.endedAt || body.createdAt || new Date().toISOString();
    const shop = await resolveShopForCollectorEvent({ shopId: body.shopId, liveUsername: body.liveUsername });
    if (!shop?.id) throw new Error(`Không tìm thấy shop cho TikTok username ${body.liveUsername}.`);

    const ownerUserId = await findShopOwnerUserId(shop.id);
    if (!ownerUserId) throw new Error("Không tìm thấy user sở hữu shop để kết thúc live session.");

    const session = await endLiveSession({
      shopId: shop.id,
      userId: ownerUserId,
      sessionId: body.collectorSessionId,
      username: body.liveUsername,
      endedAt,
      commentCount: body.commentCount || 0,
      reason: body.reason || "live_disconnected",
    });

    const payload = {
      shopId: shop.id,
      liveSessionId: session.id,
      live_session_id: session.id,
      collectorSessionId: body.collectorSessionId,
      liveUsername: body.liveUsername,
      reason: body.reason || "live_disconnected",
      endedAt,
      createdAt: endedAt,
    };

    const sseClientCount = broadcastSseToShop(shop.id, "LIVE_DISCONNECTED", payload);
    await enqueueLiveEvent("collector-live-disconnected", payload);

    return ok(response, { accepted: true, sseClientCount, session });
  }),
);

router.post(
  "/error",
  asyncHandler(async (request, response) => {
    const body = eventSchema.parse(request.body || {});
    const createdAt = body.createdAt || new Date().toISOString();
    const shop = await resolveShopForCollectorEvent({ shopId: body.shopId, liveUsername: body.liveUsername });
    if (!shop?.id) throw new Error(`Không tìm thấy shop cho TikTok username ${body.liveUsername}.`);

    const payload = {
      shopId: shop.id,
      collectorSessionId: body.collectorSessionId,
      liveUsername: body.liveUsername,
      message: body.message || "TikTok collector error",
      reason: body.reason || "live_error",
      shouldStop: body.shouldStop ?? true,
      retry: body.retry ?? false,
      createdAt,
    };

    const sseClientCount = broadcastSseToShop(shop.id, "LIVE_ERROR", payload);
    await enqueueLiveEvent("collector-live-error", payload);

    return ok(response, { accepted: true, sseClientCount });
  }),
);

export default router;
