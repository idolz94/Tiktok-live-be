import { Router } from "express";
import { asyncHandler } from "../lib/async-handler.js";
import { ok } from "../lib/response.js";
import { requireAuth } from "../middlewares/auth.js";
import { getAccountContext, requireAccountContext } from "../services/account.service.js";
import { getCurrentLicense, getLicenseState } from "../services/license.service.js";

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

export default router;
