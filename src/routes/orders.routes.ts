import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler.js";
import { mutateCreated, mutateOk, ok } from "../lib/response.js";
import { requireAuth } from "../middlewares/auth.js";
import { requireUsableAccountContext } from "../services/account.service.js";
import {
  addOrderItem,
  cancelShipment,
  createOrderFromComment,
  createSpxShipment,
  deleteOrder,
  getShippingFee,
  getShippingTracking,
  getSpxShipmentLabel,
  getSpxTimeslots,
  listSpxVouchers,
  refreshShippingStatus,
  listOrdersLight,
  getOrderById,
  getOrderStats,
  removeOrderItem,
  submitManualShipping,
  updateOrder,
  updateSpxShipment,
  updateOrderDepositStatus,
  updateOrderStatus,
  updateOrderItem,
} from "../services/orders.service.js";

const router = Router();

const createFromCommentSchema = z.object({
  comment: z.record(z.string(), z.unknown()),
  liveSessionId: z.string().nullish(),
  customerAddressId: z.string().nullish(),
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

const orderItemCreateSchema = z.object({
  productCode: z.string().optional().default(""),
  productName: z.string().optional().default(""),
  color: z.string().optional().default(""),
  price: z.number().min(0).default(0),
  quantity: z.number().int().positive().default(1),
});

const orderItemUpdateSchema = z.object({
  productCode: z.string().optional(),
  productName: z.string().optional(),
  color: z.string().optional(),
  price: z.number().min(0).optional(),
  quantity: z.number().int().positive().optional(),
});

const shippingProviderCodeSchema = z.enum(["manual", "spx"]).default("manual");

const feeSchema = z.object({
  providerCode: z.literal("spx"),
  pickProvince: z.string().min(1),
  pickWard: z.string().min(1),
  pickAddress: z.string().optional(),
  receiverProvince: z.string().min(1),
  receiverWard: z.string().min(1),
  receiverAddress: z.string().optional(),
  weightGram: z.number().int().positive().optional(),
});

const submitSpxSchema = z.object({
  providerCode: z.literal("spx"),
  senderAddressId: z.string().uuid(),
  serviceType: z.union([z.literal(1), z.literal(2)]).default(1),
  collectType: z.union([z.literal(1), z.literal(2)]).default(1),
  pickupTimeRangeId: z.number().int().positive().optional(),
  pickupTime: z.number().int().positive().optional(),
  parcelWeightGram: z.number().int().positive(),
  parcelLengthCm: z.number().int().positive().optional(),
  parcelWidthCm: z.number().int().positive().optional(),
  parcelHeightCm: z.number().int().positive().optional(),
  parcelItemName: z.string().max(200).optional(),
  declaredValue: z.number().int().nonnegative().optional(),
  note: z.string().optional(),
  idempotencyKey: z.string().uuid(),
  paymentRole: z.union([z.literal(1), z.literal(2)]).optional(),
  pickupTimeRange: z.string().optional(),
  allowMutualCheck: z.union([z.literal(0), z.literal(1)]).optional(),
  allowTryOn: z.union([z.literal(0), z.literal(1)]).optional(),
  allowPartialDelivery: z.union([z.literal(0), z.literal(1)]).optional(),
  voucherCode: z.string().trim().min(1).optional(),
  voucherAmount: z.number().int().nonnegative().optional(),
  customerAddressId: z.string().uuid().optional(),
  codCollection: z.union([z.literal(0), z.literal(1)]).optional(),
});

const updateSpxSchema = submitSpxSchema.pick({
  serviceType: true,
  pickupTimeRangeId: true,
  pickupTime: true,
  parcelWeightGram: true,
  parcelLengthCm: true,
  parcelWidthCm: true,
  parcelHeightCm: true,
  parcelItemName: true,
  voucherCode: true,
  voucherAmount: true,
  note: true,
  customerAddressId: true,
});

const manualShippingSchema = z.object({
  providerCode: shippingProviderCodeSchema.default("manual"),
  paymentSide: z.union([z.literal(0), z.literal(1)]).default(0),
  shippingFee: z.number().min(0).optional(),
  codAmount: z.number().min(0).optional(),
  note: z.string().optional(),
  idempotencyKey: z.string().uuid(),
  senderAddressId: z.string().uuid(),
  customerAddressId: z.string().uuid().optional(),
});

const cancelShippingSchema = z.object({
  trackingId: z.string().min(1).optional(),
  reason: z.string().min(1).optional(),
  providerCode: shippingProviderCodeSchema.optional(),
});

router.use(requireAuth);

router.get(
  "/stats",
  asyncHandler(async (request, response) => {
    const context = await requireUsableAccountContext(request);
    const { dateFrom, dateTo, depositStatus, status } = z
      .object({
        dateFrom: z.string().datetime(),
        dateTo: z.string().datetime(),
        depositStatus: z.string().optional(),
        status: z.string().optional(),
      })
      .parse(request.query);
    const data = await getOrderStats({
      shopId: context.shop.id,
      dateFrom: new Date(dateFrom),
      dateTo: new Date(dateTo),
      depositStatus,
      status,
    });
    return ok(response, data);
  }),
);

router.get(
  "/spx/vouchers",
  asyncHandler(async (request, response) => {
    const context = await requireUsableAccountContext(request);
    const vouchers = await listSpxVouchers({ shopId: context.shop.id });
    return ok(response, { vouchers });
  }),
);

router.get(
  "/spx/timeslots",
  asyncHandler(async (request, response) => {
    const context = await requireUsableAccountContext(request);
    const serviceType = request.query.serviceType ? Number(request.query.serviceType) : undefined;
    const slots = await getSpxTimeslots({ shopId: context.shop.id, serviceType });
    return ok(response, { timeslots: slots });
  }),
);

router.get(
  "/",
  asyncHandler(async (request, response) => {
    const context = await requireUsableAccountContext(request);
    const shippingStatus = typeof request.query.shippingStatus === "string" ? request.query.shippingStatus : undefined;
    const status = typeof request.query.status === "string" ? statusSchema.shape.status.parse(request.query.status) : undefined;
    const limit = request.query.limit ? Math.min(Number(request.query.limit), 200) : 100;
    const offset = request.query.offset ? Number(request.query.offset) : 0;
    const orders = await listOrdersLight(context.shop.id, shippingStatus, status, limit, offset);
    return ok(response, { orders });
  }),
);

router.get(
  "/:orderId",
  asyncHandler(async (request, response) => {
    const context = await requireUsableAccountContext(request);
    const order = await getOrderById(String(request.params.orderId), context.shop.id);
    return ok(response, { order });
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
      customerAddressId: body.customerAddressId,
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
    const body = orderItemCreateSchema.parse(request.body || {});
    const item = await addOrderItem({
      shopId: context.shop.id,
      orderId: String(request.params.orderId),
      productCode: body.productCode,
      productName: body.productName,
      color: body.color,
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
    const body = orderItemUpdateSchema.parse(request.body || {});
    const item = await updateOrderItem({
      shopId: context.shop.id,
      orderId: String(request.params.orderId),
      itemId: String(request.params.itemId),
      productCode: body.productCode,
      productName: body.productName,
      color: body.color,
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
  "/:orderId/shipping/cancel",
  asyncHandler(async (request, response) => {
    const context = await requireUsableAccountContext(request);
    const body = cancelShippingSchema.parse(request.body || {});
    const result = await cancelShipment({
      shopId: context.shop.id,
      orderId: String(request.params.orderId),
      trackingId: body.trackingId,
      reason: body.reason,
    });

    return mutateOk(response, "Hủy vận đơn thành công.", { shipping: result });
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
  "/:orderId/shipping/manual",
  asyncHandler(async (request, response) => {
    const context = await requireUsableAccountContext(request);
    const body = manualShippingSchema.parse(request.body || {});

    const result = await submitManualShipping({
      shopId: context.shop.id,
      orderId: String(request.params.orderId),
      paymentSide: body.paymentSide,
      shippingFee: body.shippingFee,
      codAmount: body.codAmount,
      note: body.note,
      idempotencyKey: body.idempotencyKey,
      senderAddressId: body.senderAddressId,
      customerAddressId: body.customerAddressId,
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

router.post(
  "/:orderId/shipping/fee",
  asyncHandler(async (request, response) => {
    const context = await requireUsableAccountContext(request);
    const body = feeSchema.parse(request.body || {});
    const result = await getShippingFee({
      shopId: context.shop.id,
      orderId: String(request.params.orderId),
      providerCode: body.providerCode,
      pickProvince: body.pickProvince,
      pickWard: body.pickWard,
      pickAddress: body.pickAddress,
      receiverProvince: body.receiverProvince,
      receiverWard: body.receiverWard,
      receiverAddress: body.receiverAddress,
      weight: body.weightGram,
    });
    return ok(response, { fee: result });
  }),
);

router.post(
  "/:orderId/shipping/spx",
  asyncHandler(async (request, response) => {
    const context = await requireUsableAccountContext(request);
    const body = submitSpxSchema.parse(request.body || {});

    const result = await createSpxShipment({
      shopId: context.shop.id,
      orderId: String(request.params.orderId),
      senderAddressId: body.senderAddressId,
      serviceType: body.serviceType,
      collectType: body.collectType,
      pickupTimeRangeId: body.pickupTimeRangeId,
      pickupTime: body.pickupTime,
      parcelWeightGram: body.parcelWeightGram,
      parcelLengthCm: body.parcelLengthCm,
      parcelWidthCm: body.parcelWidthCm,
      parcelHeightCm: body.parcelHeightCm,
      parcelItemName: body.parcelItemName,
      declaredValue: body.declaredValue,
      note: body.note,
      idempotencyKey: body.idempotencyKey,
      paymentRole: body.paymentRole,
      pickupTimeRange: body.pickupTimeRange,
      allowMutualCheck: body.allowMutualCheck,
      allowTryOn: body.allowTryOn,
      allowPartialDelivery: body.allowPartialDelivery,
      voucherCode: body.voucherCode,
      voucherAmount: body.voucherAmount,
      customerAddressId: body.customerAddressId,
      codCollection: body.codCollection,
    });

    return mutateOk(response, "Tạo vận đơn SPX thành công.", { shipping: result });
  }),
);

router.patch(
  "/:orderId/shipping/spx",
  asyncHandler(async (request, response) => {
    const context = await requireUsableAccountContext(request);
    const body = updateSpxSchema.parse(request.body || {});

    const result = await updateSpxShipment({
      shopId: context.shop.id,
      orderId: String(request.params.orderId),
      serviceType: body.serviceType,
      pickupTimeRangeId: body.pickupTimeRangeId,
      pickupTime: body.pickupTime,
      parcelWeightGram: body.parcelWeightGram,
      parcelLengthCm: body.parcelLengthCm,
      parcelWidthCm: body.parcelWidthCm,
      parcelHeightCm: body.parcelHeightCm,
      parcelItemName: body.parcelItemName,
      voucherCode: body.voucherCode,
      voucherAmount: body.voucherAmount,
      note: body.note,
      customerAddressId: body.customerAddressId,
    });

    return mutateOk(response, "Cập nhật vận đơn SPX thành công.", { shipping: result });
  }),
);

router.get(
  "/:orderId/shipping/label",
  asyncHandler(async (request, response) => {
    const context = await requireUsableAccountContext(request);
    const result = await getSpxShipmentLabel({
      shopId: context.shop.id,
      orderId: String(request.params.orderId),
    });
    return ok(response, result);
  }),
);

router.post(
  "/:orderId/shipping/refresh",
  asyncHandler(async (request, response) => {
    const context = await requireUsableAccountContext(request);
    const result = await refreshShippingStatus({
      shopId: context.shop.id,
      orderId: String(request.params.orderId),
    });
    return ok(response, { tracking: result });
  }),
);

export default router;
