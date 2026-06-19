import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler.js";
import { mutateCreated, mutateOk, ok } from "../lib/response.js";
import { requireAuth } from "../middlewares/auth.js";
import { requireUsableAccountContext } from "../services/account.service.js";
import {
  addOrderItem,
  createOrderFromComment,
  deleteOrder,
  getOrderForShop,
  getShippingFee,
  getShippingTracking,
  listOrders,
  removeOrderItem,
  submitManualShipping,
  submitOrderToGhtk,
  updateOrder,
  updateOrderDepositStatus,
  updateOrderStatus,
  updateOrderItem,
} from "../services/orders.service.js";
import { getGhtkToken, ghtkCancelOrder } from "../services/providers/ghtk.service.js";
import { badRequest } from "../lib/api-error.js";

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

const cancelShippingSchema = z.object({
  trackingId: z.string().min(1).optional(),
});

const manualShippingSchema = z.object({
  trackingCode: z.string().min(1, "Mã vận đơn không được để trống"),
  providerName: z.string().optional(),
  shippingFee: z.number().min(0).optional(),
  note: z.string().optional(),
});

const submitGhtkSchema = z.object({
  pickName: z.string().min(1),
  pickAddress: z.string().optional().default(""),
  pickProvince: z.string().min(1),
  pickDistrict: z.string().min(1),
  pickWard: z.string().optional(),
  pickTel: z.string().min(1),
  receiverName: z.string().min(1),
  receiverAddress: z.string().optional().default(""),
  receiverProvince: z.string().min(1),
  receiverDistrict: z.string().min(1),
  receiverWard: z.string().min(1),
  receiverHamlet: z.string().optional(),
  receiverTel: z.string().min(1),
  note: z.string().optional(),
  isFreeShip: z.union([z.literal(0), z.literal(1)]).optional(),
  transport: z.enum(["road", "fly"]).optional(),
  pickOption: z.enum(["cod", "post"]).optional(),
});

router.use(requireAuth);

router.get(
  "/",
  asyncHandler(async (request, response) => {
    const context = await requireUsableAccountContext(request);
    const shippingStatus = typeof request.query.shippingStatus === "string" ? request.query.shippingStatus : undefined;
    const orders = await listOrders(context.shop.id, shippingStatus);
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
      userId: context.userId,
      comment: body.comment,
      liveSessionId: body.liveSessionId,
      price: body.price,
      quantity: body.quantity,
      note: body.note,
    });

    return mutateCreated(response, "Tạo đơn thành công.", result);
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
    return mutateOk(response, "Cập nhật trạng thái thanh toán thành công.", { order });
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
    return mutateCreated(response, "Thêm sản phẩm thành công.", { item });
  }),
);

router.delete(
  "/:orderId/items/:itemId",
  asyncHandler(async (request, response) => {
    const context = await requireUsableAccountContext(request);
    await removeOrderItem({
      shopId: context.shop.id,
      orderId: String(request.params.orderId),
      itemId: String(request.params.itemId),
    });
    return mutateOk(response, "Xóa sản phẩm thành công.", null);
  }),
);

router.patch(
  "/:orderId/items/:itemId",
  asyncHandler(async (request, response) => {
    const context = await requireUsableAccountContext(request);
    const body = orderItemSchema.parse(request.body || {});
    const item = await updateOrderItem({
      shopId: context.shop.id,
      orderId: String(request.params.orderId),
      itemId: String(request.params.itemId),
      productCode: body.productCode,
      productName: body.productName,
      price: body.price,
      quantity: body.quantity,
    });
    return mutateOk(response, "Cập nhật sản phẩm thành công.", { item });
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
    return mutateOk(response, "Cập nhật trạng thái đơn hàng thành công.", { order });
  }),
);

router.post(
  "/:orderId/shipping/fee",
  asyncHandler(async (request, response) => {
    const context = await requireUsableAccountContext(request);
    const b = request.body as Record<string, string | undefined>;

    const result = await getShippingFee({
      shopId: context.shop.id,
      orderId: String(request.params.orderId),
      pickProvince: b.pickProvince ?? "",
      pickDistrict: b.pickDistrict ?? "",
      pickWard: b.pickWard,
      pickAddress: b.pickAddress,
      receiverProvince: b.receiverProvince ?? "",
      receiverDistrict: b.receiverDistrict ?? "",
      receiverWard: b.receiverWard,
      receiverAddress: b.receiverAddress,
      weight: b.weight ? Number(b.weight) : undefined,
      transport: b.transport === "fly" ? "fly" : b.transport === "road" ? "road" : undefined,
    });

    return ok(response, { fee: result });
  }),
);

router.get(
  "/:orderId/shipping/tracking",
  asyncHandler(async (request, response) => {
    const context = await requireUsableAccountContext(request);
    const result = await getShippingTracking({
      shopId: context.shop.id,
      orderId: String(request.params.orderId),
    });
    return ok(response, { tracking: result });
  }),
);

router.post(
  "/:orderId/shipping/submit",
  asyncHandler(async (request, response) => {
    const context = await requireUsableAccountContext(request);
    const body = submitGhtkSchema.parse(request.body || {});

    const result = await submitOrderToGhtk({
      shopId: context.shop.id,
      orderId: String(request.params.orderId),
      ...body,
    });

    return mutateOk(response, "Đăng đơn GHTK thành công.", { shipping: result });
  }),
);

router.post(
  "/:orderId/shipping/cancel",
  asyncHandler(async (request, response) => {
    const context = await requireUsableAccountContext(request);
    const body = cancelShippingSchema.parse(request.body || {});

    const order = await getOrderForShop(String(request.params.orderId), context.shop.id);

    const trackingId = body.trackingId ?? order.orderCode ?? "";
    if (!trackingId) throw badRequest("Đơn hàng chưa có mã vận đơn để hủy.");

    const token = await getGhtkToken(context.shop.id);
    if (!token) throw badRequest("Shop chưa cấu hình token GHTK. Vui lòng vào cài đặt để thêm token.");

    const result = await ghtkCancelOrder({ token, trackingId });

    return mutateOk(response, "Hủy vận đơn GHTK thành công.", { logId: result.logId });
  }),
);

router.post(
  "/:orderId/shipping/manual",
  asyncHandler(async (request, response) => {
    const context = await requireUsableAccountContext(request);
    const body = manualShippingSchema.parse(request.body || {});

    const result = await submitManualShipping({
      shopId: context.shop.id,
      orderId: String(request.params.orderId),
      trackingCode: body.trackingCode,
      providerName: body.providerName,
      shippingFee: body.shippingFee,
      note: body.note,
    });

    return mutateOk(response, "Tạo vận đơn thủ công thành công.", { shipping: result });
  }),
);

router.delete(
  "/:orderId",
  asyncHandler(async (request, response) => {
    const context = await requireUsableAccountContext(request);
    await deleteOrder({ shopId: context.shop.id, orderId: String(request.params.orderId) });
    return mutateOk(response, "Xóa đơn hàng thành công.", null);
  }),
);

const patchOrderSchema = z.object({
  customerAddressId: z.string().nullish(),
  note: z.string().optional(),
  color: z.string().nullish(),
  codAmount: z.number().min(0).optional(),
});

router.patch(
  "/:orderId",
  asyncHandler(async (request, response) => {
    const context = await requireUsableAccountContext(request);
    const body = patchOrderSchema.parse(request.body || {});
    const updated = await updateOrder({
      shopId: context.shop.id,
      orderId: String(request.params.orderId),
      customerAddressId: body.customerAddressId,
      note: body.note,
      color: body.color,
      codAmount: body.codAmount,
    });
    return mutateOk(response, "Cập nhật đơn hàng thành công.", { order: updated });
  }),
);

export default router;
