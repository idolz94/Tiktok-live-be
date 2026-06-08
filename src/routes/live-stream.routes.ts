import { randomUUID } from "crypto";
import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler.js";
import { ok } from "../lib/response.js";
import { addSseClient, getSseStats } from "../lib/sse-hub.js";
import { requireAuth } from "../middlewares/auth.js";
import { requireUsableAccountContext } from "../services/account.service.js";
import { startPythonCollector, stopPythonCollector } from "../services/python-collector.service.js";
import { endRunningLiveSession } from "../services/live-sessions.service.js";

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
    const removeClient = addSseClient({
      id: clientId,
      shopId: context.shop.id,
      userId: context.user.id,
      response,
      connectedAt: new Date().toISOString(),
    });

    const ping = setInterval(() => {
      response.write(`event: PING\n`);
      response.write(`data: ${JSON.stringify({ time: new Date().toISOString() })}\n\n`);
    }, 25000);

    request.on("close", () => {
      clearInterval(ping);
      removeClient();
    });
  }),
);

router.post(
  "/start",
  requireAuth,
  asyncHandler(async (request, response) => {
    const context = await requireUsableAccountContext(request);
    const body = usernameSchema.parse(request.body || {});
    const collector = await startPythonCollector({
      username: body.username,
      shopId: context.shop.id,
    });
    return ok(response, { collector });
  }),
);
router.post(
  "/stop",
  requireAuth,
  asyncHandler(async (request, response) => {
    const context = await requireUsableAccountContext(request);
    const username = String(request.body?.username || "").trim();

    const collector = await stopPythonCollector({
      username,
    });

    const session = await endRunningLiveSession({
      shopId: context.shop.id,
      tiktokUsername: username,
      reason: "manual_stop",
    });

    return ok(response, {
      collector,
      session,
    });
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
