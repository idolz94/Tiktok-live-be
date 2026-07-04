import { randomUUID } from "crypto";
import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler.js";
import logger from "../lib/logger.js";
import { mutateOk, ok } from "../lib/response.js";
import { addSseClient, getSseStats } from "../lib/sse-hub.js";
import { requireAuth } from "../middlewares/auth.js";
import { requireUsableAccountContext } from "../services/account.service.js";
import { startTikTokCollector, stopTikTokCollector } from "../services/tiktok-collector.service.js";
import { endRunningLiveSession, getRunningLiveSession } from "../services/live-sessions.service.js";
import { getLiveSessionComments } from "../services/live-comments.service.js";

const router = Router();

const usernameSchema = z.object({
  username: z.string().min(1, "Thiếu username."),
});

const stopSchema = z.object({
  username: z.string().min(1, "Thiếu username."),
  silent: z.boolean().optional().default(false),
});

router.get(
  "/events",
  requireAuth,
  asyncHandler(async (request, response) => {
    const context = await requireUsableAccountContext(request);

    response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    response.setHeader("Cache-Control", "no-cache, no-transform");
    response.setHeader("Connection", "keep-alive");
    response.setHeader("X-Accel-Buffering", "no");
    response.flushHeaders?.();

    const clientId = String(request.query.clientId || randomUUID());
    logger.debug({ clientId, shopId: context.shop.id, userId: context.userId }, "[SSE] client connected");

    const removeClient = addSseClient({
      id: clientId,
      shopId: context.shop.id,
      userId: context.userId,
      response,
      connectedAt: new Date().toISOString(),
    });

    const ping = setInterval(() => {
      response.write(`event: PING\n`);
      response.write(`data: ${JSON.stringify({ time: new Date().toISOString() })}\n\n`);
    }, 25000);

    request.on("close", () => {
      logger.debug({ clientId, shopId: context.shop.id }, "[SSE] client disconnected");
      clearInterval(ping);
      removeClient();
    });
  }),
);

router.post(
  "/start",
  requireAuth,
  asyncHandler(async (request, response) => {
    logger.debug({ body: request.body }, "[LIVE-STREAM] POST /start");
    const context = await requireUsableAccountContext(request);
    const body = usernameSchema.parse(request.body || {});

    try {
      const collectorResult = await startTikTokCollector({
        username: body.username,
        shopId: context.shop.id,
      });
      logger.info({ result: collectorResult }, "[COLLECTOR_START]");
    } catch (error: any) {
      logger.error({ err: error?.message || error }, "[COLLECTOR_START_FAILED]");
      return response.status(400).json({
        ok: false,
        message: error?.message || "Không thể kết nối TikTok live. Kiểm tra lại username hoặc tài khoản chưa live.",
      });
    }

    return mutateOk(response, "Đã bắt đầu kết nối live stream.", {
      status: "starting",
      username: body.username,
    });
  }),
);
router.post(
  "/stop",
  requireAuth,
  asyncHandler(async (request, response) => {
    const context = await requireUsableAccountContext(request);
    const body = stopSchema.parse(request.body || {});
    const { username, silent } = body;

    const collector = await stopTikTokCollector({
      username,
      silent,
    });

    logger.info({ result: collector }, "[COLLECTOR_STOP]");

    if (!silent) {
      // Fire-and-forget: don't wait for DB cleanup on the critical path
      endRunningLiveSession({
        shopId: context.shop.id,
        tiktokUsername: username,
        reason: "manual_stop",
      }).catch(() => {});
    }

    return mutateOk(response, "Đã gửi yêu cầu dừng live stream.", {
      collector,
    });
  }),
);

router.get(
  "/running-session",
  requireAuth,
  asyncHandler(async (request, response) => {
    const context = await requireUsableAccountContext(request);
    const session = await getRunningLiveSession({ shopId: context.shop.id });

    if (!session) {
      return ok(response, { session: null, comments: [] });
    }

    const comments = await getLiveSessionComments({
      shopId: context.shop.id,
      liveSessionId: session.id,
    });

    // Return oldest-first so the frontend can render in chronological order
    return ok(response, { session, comments: comments.reverse() });
  }),
);

router.get(
  "/stats",
  requireAuth,
  asyncHandler(async (_request, response) => {
    return ok(response, { sse: getSseStats() });
  }),
);

export default router;
