import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler.js";
import { ok } from "../lib/response.js";
import { requireAuth } from "../middlewares/auth.js";
import { requireUsableAccountContext } from "../services/account.service.js";
import { listLiveHistory } from "../services/history.service.js";
import { getLiveSessionReport } from "../services/live-session-insights.service.js";
import { endLiveSession, startLiveSession } from "../services/live-sessions.service.js";
import { enqueueLiveEvent } from "../lib/queues.js";

const router = Router();

const startSchema = z.object({
  sessionId: z.string().min(1, "Thiếu sessionId."),
  username: z.string().min(1, "Thiếu username."),
  startedAt: z.string().min(1, "Thiếu startedAt."),
});

const metricsParamsSchema = z.object({
  sessionId: z.string().min(1, "Thiếu sessionId."),
});

const endSchema = z.object({
  sessionId: z.string().min(1, "Thiếu sessionId."),
  username: z.string().min(1, "Thiếu username."),
  startedAt: z.string().nullish(),
  endedAt: z.string().min(1, "Thiếu endedAt."),
  durationSeconds: z.number().optional(),
  commentCount: z.number().optional(),
  reason: z.string().optional().default("live_ended"),
});

router.use(requireAuth);

router.get(
  "/history",
  asyncHandler(async (request, response) => {
    const context = await requireUsableAccountContext(request);
    const limit = Number(request.query.limit || 100);
    const sessions = await listLiveHistory({ shopId: context.shop.id, limit });
    return ok(response, { sessions });
  }),
);

router.get(
  "/:sessionId/metrics",
  asyncHandler(async (request, response) => {
    const context = await requireUsableAccountContext(request);
    const { sessionId } = metricsParamsSchema.parse(request.params);
    const report = await getLiveSessionReport({ shopId: context.shop.id, sessionId });
    return ok(response, report);
  }),
);

router.post(
  "/started",
  asyncHandler(async (request, response) => {
    const context = await requireUsableAccountContext(request);
    const body = startSchema.parse(request.body || {});
    const session = await startLiveSession({
      shopId: context.shop.id,
      userId: context.userId,
      sessionId: body.sessionId,
      username: body.username,
      startedAt: body.startedAt,
    });

    await enqueueLiveEvent("session-started", {
      shopId: context.shop.id,
      liveSessionId: session.id,
      externalSessionId: body.sessionId,
    });

    return ok(response, { session });
  }),
);

router.post(
  "/ended",
  asyncHandler(async (request, response) => {
    const context = await requireUsableAccountContext(request);
    const body = endSchema.parse(request.body || {});
    const session = await endLiveSession({
      shopId: context.shop.id,
      userId: context.userId,
      sessionId: body.sessionId,
      username: body.username,
      startedAt: body.startedAt,
      endedAt: body.endedAt,
      durationSeconds: body.durationSeconds,
      commentCount: body.commentCount,
      reason: body.reason,
    });

    await enqueueLiveEvent("session-ended", {
      shopId: context.shop.id,
      liveSessionId: session.id,
      externalSessionId: body.sessionId,
    });

    return ok(response, { session });
  }),
);

export default router;
