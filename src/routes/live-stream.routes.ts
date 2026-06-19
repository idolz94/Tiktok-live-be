import { randomUUID } from "crypto";
import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler.js";
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
    console.log(`[SSE] client connected clientId=${clientId} shopId=${context.shop.id} userId=${context.userId}`);

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
      console.log(`[SSE] client disconnected clientId=${clientId} shopId=${context.shop.id}`);
      clearInterval(ping);
      removeClient();
    });
  }),
);

router.post(
  "/start",
  requireAuth,
  asyncHandler(async (request, response) => {
    console.log("[LIVE-STREAM] POST /start hit — body:", JSON.stringify(request.body));
    const context = await requireUsableAccountContext(request);
    const body = usernameSchema.parse(request.body || {});

    try {
      const collectorResult = await startTikTokCollector({
        username: body.username,
        shopId: context.shop.id,
      });
      console.log("[COLLECTOR_START]", JSON.stringify(collectorResult));
    } catch (error: any) {
      console.error("[COLLECTOR_START_FAILED]", error?.message || error);
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
    const username = String(request.body?.username || "").trim();
    const silent = Boolean(request.body?.silent);

    const collector = await stopTikTokCollector({
      username,
      silent,
    });

    console.log("[COLLECTOR_STOP]", JSON.stringify(collector));

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
