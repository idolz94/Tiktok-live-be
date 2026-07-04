import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler.js";
import { ok } from "../lib/response.js";
import { requireInternalApiKey } from "../middlewares/internal-api-key.js";
import { activateLicenseFromPayment, getCurrentLicense, changeLicenseTier } from "../services/license.service.js";
import { seedLicensePlans } from "../db/seed-license-plans.js";

const router = Router();

router.use(requireInternalApiKey);

const activateSchema = z.object({
  shopId: z.string().uuid(),
  planCode: z.enum(["trial", "basic", "pro", "vip"]).default("basic"),
  months: z.number().int().min(1).max(24).default(1),
  price: z.number().min(0).default(0),
  paymentId: z.string().optional().nullable(),
});

router.post(
  "/licenses/activate",
  asyncHandler(async (request, response) => {
    const body = activateSchema.parse(request.body || {});
    const license = await activateLicenseFromPayment({
      shopId: body.shopId,
      planCode: body.planCode,
      months: body.months,
      price: body.price,
      paymentId: body.paymentId ?? null,
    });
    return ok(response, { license });
  }),
);

router.get(
  "/licenses/:shopId",
  asyncHandler(async (request, response) => {
    const license = await getCurrentLicense(String(request.params.shopId));
    return ok(response, { license });
  }),
);

router.post(
  "/seed-plans",
  asyncHandler(async (_request, response) => {
    await seedLicensePlans();
    return ok(response, { seeded: true });
  }),
);

const tierSchema = z.object({
  planCode: z.enum(["trial", "basic", "pro", "vip"]),
});

router.patch(
  "/licenses/:shopId/tier",
  asyncHandler(async (request, response) => {
    const shopId = String(request.params.shopId);
    const body = tierSchema.parse(request.body || {});
    const license = await changeLicenseTier({ shopId, planCode: body.planCode });
    return ok(response, { license });
  }),
);

export default router;
