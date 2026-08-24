// ponytail: endpoint nội bộ cho service/project khác (vd: 1 service Python) gọi vào để
// chấm điểm + phân loại intent 1 đoạn comment, không cần biết gì về DB/schema của Backend.
// Bảo vệ bằng requireInternalApiKey (header x-internal-api-key) — cùng cơ chế đã dùng cho
// /api/internal/live-comments/ingest, không phải JWT user như các route Mobile.
import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler.js";
import { badRequest } from "../lib/api-error.js";
import { ok } from "../lib/response.js";
import { requireInternalApiKey } from "../middlewares/internal-api-key.js";
import { scoreCommentForShop, scoreCommentText } from "../services/comment-scoring/index.js";

const router = Router();

router.use(requireInternalApiKey);

const scoreSchema = z.object({
  text: z.string().trim().min(1),
  // shopId optional — có thì chấm kèm match preset theo catalog shop đó (scoreCommentForShop),
  // không có thì chấm thuần trên text (scoreCommentText).
  shopId: z.string().optional(),
  isHost: z.boolean().optional(),
});

router.post(
  "/score",
  asyncHandler(async (request, response) => {
    const body = scoreSchema.parse(request.body || {});
    if (body.shopId && !body.shopId.trim()) throw badRequest("shopId không hợp lệ.");

    const result = body.shopId
      ? await scoreCommentForShop(body.shopId, body.text, { isHost: body.isHost })
      : scoreCommentText(body.text);

    return ok(response, { result });
  }),
);

export default router;
