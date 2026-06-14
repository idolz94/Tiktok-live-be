import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler.js";
import { ok, mutateOk } from "../lib/response.js";
import { requireAuth } from "../middlewares/auth.js";
import { requireShopId } from "../services/account.service.js";
import { getProductDefaults, upsertProductDefaults } from "../services/shop-settings.service.js";

const router = Router();

const patchProductDefaultsSchema = z.object({
  code: z.string().optional(),
  color: z.string().optional(),
  size: z.string().optional(),
  price: z.number().min(0).optional(),
});

// GET /api/me/shop-settings/product-defaults
router.get(
  "/product-defaults",
  requireAuth,
  asyncHandler(async (request, response) => {
    const shopId = await requireShopId(request);
    const data = await getProductDefaults(shopId);
    return ok(response, data);
  }),
);

// PATCH /api/me/shop-settings/product-defaults
router.patch(
  "/product-defaults",
  requireAuth,
  asyncHandler(async (request, response) => {
    const shopId = await requireShopId(request);
    const body = patchProductDefaultsSchema.parse(request.body || {});
    const data = await upsertProductDefaults(shopId, body);
    return mutateOk(response, "Lưu cài đặt thành công.", data);
  }),
);

export default router;
