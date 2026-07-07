import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler.js";
import { ok } from "../lib/response.js";
import { notFound } from "../lib/api-error.js";
import { requireAuth } from "../middlewares/auth.js";
import { requireManager } from "../middlewares/require-role.js";
import { getAccountContext, requireAccountContext } from "../services/account.service.js";
import { getCurrentLicense, getLicenseState, activateLicenseFromPayment, findShopByUsername } from "../services/license.service.js";

const router = Router();

router.get(
  "/current",
  requireAuth,
  asyncHandler(async (request, response) => {
    const context = await getAccountContext(request);
    return ok(response, {
      license: context.license,
      canUseApp: context.canUseApp,
      reason: context.reason,
    });
  }),
);

router.post(
  "/refresh",
  requireAuth,
  asyncHandler(async (request, response) => {
    const context = await requireAccountContext(request);
    const license = await getCurrentLicense(context.shop.id);
    const licenseState = getLicenseState(license);
    return ok(response, { license, ...licenseState });
  }),
);

const adminActivateSchema = z.object({
  username: z.string().min(1),
  planCode: z.enum(["trial", "basic", "pro", "vip"]).default("basic"),
  months: z.number().int().min(1).max(24).default(1),
  price: z.number().min(0).default(0),
});

// Admin-only: gia hạn license cho user khác
router.post(
  "/admin-activate",
  requireAuth,
  requireManager,
  asyncHandler(async (request, response) => {
    const body = adminActivateSchema.parse(request.body || {});

    const input = body.username.trim().toLowerCase();
    const found = await findShopByUsername(input);

    if (!found) {
      throw notFound(`Không tìm thấy user hoặc shop cho "${body.username}".`);
    }

    const license = await activateLicenseFromPayment({
      shopId: found.shopId,
      planCode: body.planCode,
      months: body.months,
      price: body.price,
      activatedBy: request.authUserId,
    });

    return ok(response, { license, shopId: found.shopId, shopName: found.shopName });
  }),
);

export default router;

