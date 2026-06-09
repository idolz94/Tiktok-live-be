import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler.js";
import { ok } from "../lib/response.js";
import { requireAuth } from "../middlewares/auth.js";
import { requireUsableAccountContext } from "../services/account.service.js";
import {
  addOrderItem,
  createOrderFromComment,
  deleteOrder,
  listOrders,
  removeOrderItem,
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

const orderItemSchema = z.object({
  productCode: z.string().optional().default(""),
  productName: z.string().optional().default(""),
  price: z.number().min(0).default(0),
  quantity: z.number().int().positive().default(1),
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

router.post(
  "/:orderId/items",
  asyncHandler(async (request, response) => {
    const context = await requireUsableAccountContext(request);
    const body = orderItemSchema.parse(request.body || {});
    const item = await addOrderItem({
      shopId: context.shop.id,
      orderId: String(request.params.orderId),
      productCode: body.productCode,
      productName: body.productName,
      price: body.price,
      quantity: body.quantity,
    });
    return ok(response, { item }, 201);
  }),
);

router.delete(
  "/:orderId/items/:itemId",
  asyncHandler(async (request, response) => {
    const context = await requireUsableAccountContext(request);
    const result = await removeOrderItem({
      shopId: context.shop.id,
      orderId: String(request.params.orderId),
      itemId: String(request.params.itemId),
    });
    return ok(response, result);
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
