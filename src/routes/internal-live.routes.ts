import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler.js";
import { badRequest } from "../lib/api-error.js";
import { ok } from "../lib/response.js";
import { requireInternalApiKey } from "../middlewares/internal-api-key.js";
import { ingestCollectorComment } from "../services/internal-live-ingest.service.js";

const router = Router();

router.use(requireInternalApiKey);

const ingestSchema = z.object({
  shopId: z.string().optional(),
  liveUsername: z.string().min(1),
  collectorSessionId: z.string().optional(),
  comment: z.any(),
  createdAt: z.string().optional(),
});

router.post(
  "/live-comments/ingest",
  asyncHandler(async (req, res) => {
    const body = ingestSchema.parse(req.body || {});
    if (!body.comment) throw badRequest("Thiếu comment payload.");
    const sid = body.collectorSessionId?.trim() || `ext-${Date.now()}`;
    const result = await ingestCollectorComment({
      shopId: body.shopId ?? null,
      liveUsername: body.liveUsername,
      collectorSessionId: sid,
      comment: body.comment,
      createdAt: body.createdAt ?? new Date().toISOString(),
    });
    if (!result) throw badRequest("Không resolve được shop/session.");
    return ok(res, result);
  }),
);

const liveEventSchema = z.object({
  eventType: z.enum(["LIVE_CONNECTED", "LIVE_DISCONNECTED", "LIVE_ERROR", "COLLECTOR_STOPPED"]),
  shopId: z.string().optional(),
  liveUsername: z.string().min(1),
  collectorSessionId: z.string().optional(),
  reason: z.string().optional(),
  message: z.string().optional(),
});

router.post(
  "/live-events",
  asyncHandler(async (req, res) => {
    const body = liveEventSchema.parse(req.body || {});
    // ponytail: collector live events are handled in-process via tiktok-collector.service today;
    // HTTP path exists so an external collector binary can drive the same flow without DB access.
    // For now just acknowledge — state machine stays in tiktok-collector.service.
    return ok(res, { accepted: true, eventType: body.eventType });
  }),
);

export default router;
