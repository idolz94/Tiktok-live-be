import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler.js";
import { ok } from "../lib/response.js";
import { requireAuth } from "../middlewares/auth.js";
import { requireUsableAccountContext } from "../services/account.service.js";
import {
  createOrderFromComment,
  deleteOrder,
  listOrders,
  updateOrderDepositStatus,
  updateOrderStatus,
} from "../services/orders.service.js";

const router = Router();

const createFromCommentSchema = z.object({
  comment: z.any(),
  liveSessionId: z.string().nullish(),
  price: z.number().optional(),
  quantity: z.number().optional(),
  note: z.string().optional().default(""),
});

const depositSchema = z.object({
  depositStatus: z.enum(["unpaid", "paid", "deposited", "refunded"]),
});

const statusSchema = z.object({
  status: z.enum(["draft", "confirmed", "packed", "shipping", "completed", "canceled", "returned"]),
});

router.use(requireAuth);

router.get(
  "/",
  asyncHandler(async (request, response) => {
    const context = await requireUsableAccountContext(request);
    const orders = await listOrders(context.shop.id);
    return ok(response, { orders });
  }),
);

router.post(
  "/from-comment",
  asyncHandler(async (request, response) => {
    const context = await requireUsableAccountContext(request);
    const body = createFromCommentSchema.parse(request.body || {});

    const result = await createOrderFromComment({
      shopId: context.shop.id,
      userId: context.user.id,
      comment: body.comment,
      liveSessionId: body.liveSessionId,
      price: body.price,
      quantity: body.quantity,
      note: body.note,
    });

    return ok(response, result, 201);
  }),
);

router.patch(
  "/:orderId/deposit-status",
  asyncHandler(async (request, response) => {
    const context = await requireUsableAccountContext(request);
    const body = depositSchema.parse(request.body || {});
    const order = await updateOrderDepositStatus({
      shopId: context.shop.id,
      orderId: String(request.params.orderId),
      depositStatus: body.depositStatus,
    });
    return ok(response, { order });
  }),
);

router.patch(
  "/:orderId/status",
  asyncHandler(async (request, response) => {
    const context = await requireUsableAccountContext(request);
    const body = statusSchema.parse(request.body || {});
    const order = await updateOrderStatus({
      shopId: context.shop.id,
      orderId: String(request.params.orderId),
      status: body.status,
    });
    return ok(response, { order });
  }),
);

router.delete(
  "/:orderId",
  asyncHandler(async (request, response) => {
    const context = await requireUsableAccountContext(request);
    const result = await deleteOrder({ shopId: context.shop.id, orderId: String(request.params.orderId) });
    return ok(response, result);
  }),
);

export default router;
