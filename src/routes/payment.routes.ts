import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler.js";
import { ok } from "../lib/response.js";
import { requireAuth } from "../middlewares/auth.js";
import { requireAccountContext } from "../services/account.service.js";
import { confirmManualPayment, createManualCheckout } from "../services/payment.service.js";

const router = Router();

const checkoutSchema = z.object({
  planCode: z.string().default("basic"),
  months: z.number().optional().default(1),
  amount: z.number().optional().default(0),
});

const confirmSchema = z.object({
  paymentId: z.string().min(1),
});

router.post(
  "/checkout",
  requireAuth,
  asyncHandler(async (request, response) => {
    const context = await requireAccountContext(request);
    const body = checkoutSchema.parse(request.body || {});
    const data = await createManualCheckout({
      shopId: context.shop.id,
      planCode: body.planCode,
      months: body.months,
      amount: body.amount,
    });
    return ok(response, data);
  }),
);

router.post(
  "/manual-confirm",
  requireAuth,
  asyncHandler(async (request, response) => {
    const context = await requireAccountContext(request);
    const body = confirmSchema.parse(request.body || {});
    const data = await confirmManualPayment({ paymentId: body.paymentId, shopId: context.shop.id });
    return ok(response, data);
  }),
);

export default router;
