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
  eventId: z.string().optional().nullable(),
  eventType: z.string().optional().nullable(),

  shopId: z.string().optional().nullable(),

  // Python có thể gửi liveUsername hoặc username
  liveUsername: z.string().optional().nullable(),
  username: z.string().optional().nullable(),

  collectorSessionId: z.string().optional().nullable(),
  liveSessionId: z.string().optional().nullable(),

  roomId: z.string().optional().nullable(),

  message: z.string().optional().nullable(),
  reason: z.string().optional().nullable(),
  shouldStop: z.boolean().optional(),
  retry: z.boolean().optional(),

  startedAt: z.string().optional().nullable(),
  endedAt: z.string().optional().nullable(),
  createdAt: z.string().optional().nullable(),

  commentCount: z.number().optional().nullable(),
  lastCommentAt: z.string().optional().nullable(),
});

type CollectorEventBody = z.infer<typeof eventSchema> & {
  liveUsername: string;
  collectorSessionId: string;
};

function normalizeCollectorEventBody(input: unknown): CollectorEventBody {
  const body = eventSchema.parse(input || {});

  const liveUsername = String(body.liveUsername || body.username || "").trim();

  if (!liveUsername) {
    throw new Error("Thiếu liveUsername.");
  }

  const collectorSessionId = String(
    body.collectorSessionId || body.liveSessionId || body.eventId || "",
  ).trim();

  if (!collectorSessionId) {
    throw new Error("Thiếu collectorSessionId.");
  }

  return {
    ...body,
    liveUsername,
    collectorSessionId,
  };
}

async function resolveShopOrThrow(body: CollectorEventBody) {
  const shop = await resolveShopForCollectorEvent({
    shopId: body.shopId,
    liveUsername: body.liveUsername,
  });

  if (!shop?.id) {
    throw new Error(`Không tìm thấy shop cho TikTok username ${body.liveUsername}.`);
  }

  return shop;
}

async function findOwnerUserIdOrThrow(shopId: string) {
  const ownerUserId = await findShopOwnerUserId(shopId);

  if (!ownerUserId) {
    throw new Error("Không tìm thấy user sở hữu shop để kết thúc live session.");
  }

  return ownerUserId;
}

async function endCollectorLiveSession({
  body,
  shopId,
  reason,
  endedAt,
}: {
  body: CollectorEventBody;
  shopId: string;
  reason: string;
  endedAt: string;
}) {
  const ownerUserId = await findOwnerUserIdOrThrow(shopId);

  return endLiveSession({
    shopId,
    userId: ownerUserId,
    sessionId: body.collectorSessionId,
    username: body.liveUsername,
    endedAt,
    commentCount: body.commentCount ?? undefined,
    reason,
  });
}

async function handleConnected(body: CollectorEventBody, response: any) {
  const createdAt = body.createdAt || body.startedAt || new Date().toISOString();

  const shop = await resolveShopOrThrow(body);

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
    roomId: body.roomId || null,
    startedAt: session.started_at || createdAt,
    createdAt,
  };

  const sseClientCount = broadcastSseToShop(shop.id, "LIVE_CONNECTED", payload);

  await enqueueLiveEvent("collector-live-connected", payload);

  return ok(response, {
    accepted: true,
    sseClientCount,
    session,
  });
}

async function handleDisconnected(body: CollectorEventBody, response: any) {
  const endedAt = body.endedAt || body.createdAt || new Date().toISOString();
  const reason = body.reason || "live_disconnected";

  const shop = await resolveShopOrThrow(body);

  const session = await endCollectorLiveSession({
    body,
    shopId: shop.id,
    reason,
    endedAt,
  });

  const payload = {
    shopId: shop.id,
    liveSessionId: session?.id || null,
    live_session_id: session?.id || null,
    collectorSessionId: body.collectorSessionId,
    liveUsername: body.liveUsername,
    reason,
    endedAt,
    createdAt: endedAt,
    status: "ended",
    durationSeconds: session?.duration_seconds || session?.durationSeconds || 0,
    duration_seconds: session?.duration_seconds || session?.durationSeconds || 0,
    commentCount: session?.comment_count ?? body.commentCount ?? 0,
    comment_count: session?.comment_count ?? body.commentCount ?? 0,
  };

  const sseClientCount = broadcastSseToShop(shop.id, "LIVE_DISCONNECTED", payload);

  await enqueueLiveEvent("collector-live-disconnected", payload);

  return ok(response, {
    accepted: true,
    sseClientCount,
    session,
  });
}

async function handleCollectorStopped(body: CollectorEventBody, response: any) {
  const endedAt = body.endedAt || body.createdAt || new Date().toISOString();
  const reason = body.reason || "collector_stopped";

  const shop = await resolveShopOrThrow(body);

  const session = await endCollectorLiveSession({
    body,
    shopId: shop.id,
    reason,
    endedAt,
  });

  const payload = {
    shopId: shop.id,
    liveSessionId: session?.id || null,
    live_session_id: session?.id || null,
    collectorSessionId: body.collectorSessionId,
    liveUsername: body.liveUsername,
    reason,
    endedAt,
    createdAt: endedAt,
    status: "ended",
    durationSeconds: session?.duration_seconds || session?.durationSeconds || 0,
    duration_seconds: session?.duration_seconds || session?.durationSeconds || 0,
    commentCount: session?.comment_count ?? body.commentCount ?? 0,
    comment_count: session?.comment_count ?? body.commentCount ?? 0,
  };

  const sseClientCount = broadcastSseToShop(shop.id, "COLLECTOR_STOPPED", payload);

  await enqueueLiveEvent("collector-stopped", payload);

  return ok(response, {
    accepted: true,
    sseClientCount,
    session,
  });
}

async function handleError(body: CollectorEventBody, response: any) {
  const createdAt = body.createdAt || new Date().toISOString();
  const reason = body.reason || "live_error";
  const shouldStop = body.shouldStop ?? true;

  const shop = await resolveShopOrThrow(body);

  let session: any = null;

  if (shouldStop) {
    session = await endCollectorLiveSession({
      body,
      shopId: shop.id,
      reason,
      endedAt: createdAt,
    });
  }

  const payload = {
    shopId: shop.id,
    liveSessionId: session?.id || null,
    live_session_id: session?.id || null,
    collectorSessionId: body.collectorSessionId,
    liveUsername: body.liveUsername,
    message: body.message || "TikTok collector error",
    reason,
    shouldStop,
    retry: body.retry ?? false,
    createdAt,
    endedAt: shouldStop ? createdAt : null,
    status: shouldStop ? "ended" : "running",
    durationSeconds: session?.duration_seconds || session?.durationSeconds || 0,
    duration_seconds: session?.duration_seconds || session?.durationSeconds || 0,
  };

  const sseClientCount = broadcastSseToShop(shop.id, "LIVE_ERROR", payload);

  await enqueueLiveEvent("collector-live-error", payload);

  return ok(response, {
    accepted: true,
    sseClientCount,
    session,
  });
}

router.use(requireInternalApiKey);

/**
 * Generic endpoint cho Python.
 *
 * Python nên set:
 * NODE_EVENT_INGEST_URL=https://your-domain.com/api/internal/live-events
 *
 * Sau đó Python gửi eventType:
 * LIVE_CONNECTED
 * LIVE_DISCONNECTED
 * LIVE_ERROR
 * COLLECTOR_STOPPED
 */
router.post(
  "/",
  asyncHandler(async (request, response) => {
    const body = normalizeCollectorEventBody(request.body || {});
    const eventType = String(body.eventType || "").toUpperCase();

    if (eventType === "LIVE_CONNECTED") {
      return handleConnected(body, response);
    }

    if (eventType === "LIVE_DISCONNECTED") {
      return handleDisconnected(body, response);
    }

    if (eventType === "LIVE_ERROR") {
      return handleError(body, response);
    }

    if (eventType === "COLLECTOR_STOPPED") {
      return handleCollectorStopped(body, response);
    }

    return ok(response, {
      accepted: false,
      ignored: true,
      message: `Unsupported collector eventType: ${body.eventType || "(empty)"}`,
    });
  }),
);

/**
 * Giữ compatibility nếu Python/BE cũ vẫn gọi:
 * /api/internal/live-events/connected
 */
router.post(
  "/connected",
  asyncHandler(async (request, response) => {
    const body = normalizeCollectorEventBody({
      ...(request.body || {}),
      eventType: "LIVE_CONNECTED",
    });

    return handleConnected(body, response);
  }),
);

/**
 * Giữ compatibility nếu Python/BE cũ vẫn gọi:
 * /api/internal/live-events/disconnected
 */
router.post(
  "/disconnected",
  asyncHandler(async (request, response) => {
    const body = normalizeCollectorEventBody({
      ...(request.body || {}),
      eventType: "LIVE_DISCONNECTED",
    });

    return handleDisconnected(body, response);
  }),
);

/**
 * Giữ compatibility nếu Python/BE cũ vẫn gọi:
 * /api/internal/live-events/error
 */
router.post(
  "/error",
  asyncHandler(async (request, response) => {
    const body = normalizeCollectorEventBody({
      ...(request.body || {}),
      eventType: "LIVE_ERROR",
    });

    return handleError(body, response);
  }),
);

/**
 * Thêm endpoint riêng cho collector stopped nếu muốn gọi trực tiếp.
 */
router.post(
  "/stopped",
  asyncHandler(async (request, response) => {
    const body = normalizeCollectorEventBody({
      ...(request.body || {}),
      eventType: "COLLECTOR_STOPPED",
    });

    return handleCollectorStopped(body, response);
  }),
);

export default router;