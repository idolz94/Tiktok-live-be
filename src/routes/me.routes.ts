import { Router } from "express";
import { asyncHandler } from "../lib/async-handler.js";
import { ok } from "../lib/response.js";
import { requireAuth } from "../middlewares/auth.js";
import { getAccountContext } from "../services/account.service.js";

const router = Router();

router.get(
  "/bootstrap",
  requireAuth,
  asyncHandler(async (request, response) => {
    const context = await getAccountContext(request);

    return ok(response, {
      user: context.user,
      profile: context.profile,
      shopMember: context.shopMember,
      member: context.shopMember,
      shop: context.shop,
      license: context.license,
      canUseApp: context.canUseApp,
      reason: context.reason,
    });
  }),
);

export default router;
