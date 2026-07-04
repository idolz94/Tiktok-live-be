import { eq, and } from "drizzle-orm";
import { db } from "../lib/db.js";
import { orders, orderItems, orderShipments, customerAddresses, shopAddresses } from "../db/schema/index.js";
import { badRequest } from "../lib/api-error.js";
import { assertOrderInShop, toMoney, reconcileOrderAmounts } from "./order-core.service.js";
import { getShippingProviderAdapter, normalizeShippingProviderCode } from "./providers/registry.js";
import { spxListVouchersForShop } from "./providers/spx.adapter.js";
import { getSpxCredentials } from "./providers/credentials.js";
import { spxGetLabel } from "./providers/spx.service.js";

export type GetShippingFeeParams = {
  shopId: string;
  orderId: string;
  providerCode?: string;
  pickProvince: string;
  pickDistrict?: string;
  pickWard?: string;
  pickAddress?: string;
  receiverProvince: string;
  receiverDistrict?: string;
  receiverWard?: string;
  receiverAddress?: string;
  weight?: number;
  transport?: "road" | "fly";
};

export async function getShippingFee(params: GetShippingFeeParams) {
  await assertOrderInShop(params.orderId, params.shopId);
  const provider = getShippingProviderAdapter(params.providerCode);
  return provider.getFee({
    shopId: params.shopId,
    orderId: params.orderId,
    pickProvince: params.pickProvince,
    pickDistrict: params.pickDistrict,
    pickWard: params.pickWard,
    pickAddress: params.pickAddress,
    receiverProvince: params.receiverProvince,
    receiverDistrict: params.receiverDistrict,
    receiverWard: params.receiverWard,
    receiverAddress: params.receiverAddress,
    weight: params.weight,
    transport: params.transport,
  });
}

export type EstimateAddressAdjustmentFeeParams = {
  orderId: string;
  shopId: string;
  trackingNo: string;
  senderState: string;
  senderCity: string;
  senderPostCode: string;
  senderDetailAddress: string;
  deliverState: string;
  deliverCity: string;
  deliverPostCode: string;
  deliverDetailAddress: string;
};

export async function estimateAddressAdjustmentFee(params: EstimateAddressAdjustmentFeeParams) {
  await assertOrderInShop(params.orderId, params.shopId);
  const { spxEstimateAdjustmentFee } = await import("./providers/spx.adapter.js");
  return spxEstimateAdjustmentFee(params.shopId, {
    trackingNo: params.trackingNo,
    senderState: params.senderState,
    senderCity: params.senderCity,
    senderPostCode: params.senderPostCode,
    senderDetailAddress: params.senderDetailAddress,
    deliverState: params.deliverState,
    deliverCity: params.deliverCity,
    deliverPostCode: params.deliverPostCode,
    deliverDetailAddress: params.deliverDetailAddress,
  });
}

export type SubmitShippingParams = {
  shopId: string;
  orderId: string;
  providerCode?: string;
  pickName: string;
  pickAddress: string;
  pickProvince: string;
  pickDistrict: string;
  pickWard?: string;
  pickTel: string;
  receiverName: string;
  receiverAddress: string;
  receiverProvince: string;
  receiverDistrict: string;
  receiverWard: string;
  receiverHamlet?: string;
  receiverTel: string;
  note?: string;
  isFreeShip?: 0 | 1;
  transport?: "road" | "fly";
  pickOption?: "cod" | "post";
};

function hasActiveShipment(status?: string | null) {
  return status !== null && status !== undefined && !["cancelled", "canceled"].includes(status);
}

async function getCurrentShipment(orderId: string) {
  const rows = await db.select().from(orderShipments).where(eq(orderShipments.orderId, orderId)).limit(1);
  return rows[0] ?? null;
}

type InsertShipmentExtra = {
  spxTrackingNo?: string;
  serviceType?: number;
  collectType?: number;
  pickupTime?: number;
  pickupTimeRangeId?: number;
  providerShippingFee?: number;
  parcelWeightGram?: number;
  parcelLengthCm?: number;
  parcelWidthCm?: number;
  parcelHeightCm?: number;
  parcelItemName?: string;
  declaredValue?: number;
  senderName?: string;
  senderPhone?: string;
  senderProvince?: string;
  senderDistrict?: string;
  senderWard?: string;
  senderDetailAddress?: string;
  receiverName?: string;
  receiverPhone?: string;
  receiverProvince?: string;
  receiverDistrict?: string;
  receiverWard?: string;
  receiverDetailAddress?: string;
  idempotencyKey?: string;
  errorCode?: string;
  errorMessage?: string;
};

async function insertShipmentAndUpdateOrder({
  orderId,
  shopId,
  providerCode,
  result,
  note,
  extra,
  targetOrderStatus,
}: {
  orderId: string;
  shopId: string;
  providerCode: string;
  result: Awaited<ReturnType<ReturnType<typeof getShippingProviderAdapter>["submit"]>>;
  note?: string;
  extra?: InsertShipmentExtra;
  targetOrderStatus?: string;
}) {
  const orderStatus = targetOrderStatus ?? "packed";
  const patch: Record<string, unknown> = {
    providerCode: result.providerCode,
    shippingFee: result.fee ?? undefined,
    shippingStatus: result.status ?? "submitted",
    status: orderStatus,
    updatedAt: new Date(),
  };
  if (orderStatus === "confirmed") patch.confirmedAt = new Date();
  if (result.labelPaperSize !== undefined) patch["labelPaperSize"] = result.labelPaperSize;
  if (note !== undefined) patch["note"] = note;

  await db.insert(orderShipments).values({
    orderId,
    shopId,
    providerCode,
    trackingLabel: result.trackingLabel,
    trackingCode: result.trackingCode ?? null,
    externalOrderId: result.externalOrderId ?? null,
    fee: result.fee ?? null,
    shippingFee: result.fee ?? null,
    status: result.status ?? "submitted",
    statusCode: result.statusCode ?? null,
    statusRaw: result.statusRaw ?? null,
    submittedAt: new Date(),
    estimatedPickTime: result.estimatedPickTime ?? null,
    estimatedDeliverTime: result.estimatedDeliverTime ?? null,
    labelUrl: result.labelUrl ?? null,
    labelFormat: result.labelFormat ?? null,
    labelPaperSize: result.labelPaperSize ?? null,
    paymentSide: result.paymentSide === undefined || result.paymentSide === null ? null : String(result.paymentSide),
    rawResponse: result.rawResponse as Record<string, unknown> | null,
    spxTrackingNo: extra?.spxTrackingNo ?? null,
    serviceType: extra?.serviceType ?? null,
    collectType: extra?.collectType ?? null,
    pickupTime: extra?.pickupTime ?? null,
    pickupTimeRangeId: extra?.pickupTimeRangeId ?? null,
    providerShippingFee: extra?.providerShippingFee ?? null,
    parcelWeightGram: extra?.parcelWeightGram ?? null,
    parcelLengthCm: extra?.parcelLengthCm ?? null,
    parcelWidthCm: extra?.parcelWidthCm ?? null,
    parcelHeightCm: extra?.parcelHeightCm ?? null,
    parcelItemName: extra?.parcelItemName ?? null,
    declaredValue: extra?.declaredValue ?? null,
    senderName: extra?.senderName ?? null,
    senderPhone: extra?.senderPhone ?? null,
    senderProvince: extra?.senderProvince ?? null,
    senderDistrict: extra?.senderDistrict ?? null,
    senderWard: extra?.senderWard ?? null,
    senderDetailAddress: extra?.senderDetailAddress ?? null,
    receiverName: extra?.receiverName ?? null,
    receiverPhone: extra?.receiverPhone ?? null,
    receiverProvince: extra?.receiverProvince ?? null,
    receiverDistrict: extra?.receiverDistrict ?? null,
    receiverWard: extra?.receiverWard ?? null,
    receiverDetailAddress: extra?.receiverDetailAddress ?? null,
    idempotencyKey: extra?.idempotencyKey ?? null,
    errorCode: extra?.errorCode ?? null,
    errorMessage: extra?.errorMessage ?? null,
  });

  await db.update(orders).set(patch).where(and(eq(orders.id, orderId), eq(orders.shopId, shopId)));
}

export async function createShipment(params: SubmitShippingParams) {
  const order = await assertOrderInShop(params.orderId, params.shopId);
  if ((order.status ?? "") !== "draft") {
    throw badRequest(`Không thể tạo vận đơn cho đơn hàng ở trạng thái "${order.status}".`);
  }

  const currentShipment = await getCurrentShipment(params.orderId);
  if (currentShipment && hasActiveShipment(currentShipment.status)) {
    throw badRequest("Đơn hàng đã có vận đơn. Hủy vận đơn cũ trước khi tạo mới.");
  }

  const provider = getShippingProviderAdapter(params.providerCode);
  const result = await provider.submit(params);
  await insertShipmentAndUpdateOrder({
    orderId: params.orderId,
    shopId: params.shopId,
    providerCode: result.providerCode,
    result,
    note: params.note,
    targetOrderStatus: "confirmed",
  });

  return { ...result, orderId: params.orderId };
}

export async function listSpxVouchers({ shopId }: { shopId: string }) {
  return spxListVouchersForShop(shopId);
}

export type CreateSpxShipmentParams = {
  shopId: string;
  orderId: string;
  senderAddressId: string;
  serviceType: 1 | 2;
  collectType: 1 | 2;
  pickupTimeRangeId?: number;
  pickupTime?: number;
  parcelWeightGram: number;
  parcelLengthCm?: number;
  parcelWidthCm?: number;
  parcelHeightCm?: number;
  parcelItemName?: string;
  declaredValue?: number;
  note?: string;
  idempotencyKey: string;
  voucherCode?: string;
  customerAddressId?: string;
};

export async function createSpxShipment(params: CreateSpxShipmentParams) {
  const existing = await db
    .select()
    .from(orderShipments)
    .where(eq(orderShipments.idempotencyKey, params.idempotencyKey))
    .limit(1);
  if (existing[0]) {
    return { ...existing[0], orderId: params.orderId, idempotent: true };
  }

  const order = await assertOrderInShop(params.orderId, params.shopId);
  if ((order.status ?? "") !== "draft") {
    throw badRequest(`Không thể tạo vận đơn SPX cho đơn hàng ở trạng thái "${order.status}".`);
  }

  const currentShipment = await getCurrentShipment(params.orderId);
  if (currentShipment && hasActiveShipment(currentShipment.status)) {
    throw badRequest("Đơn hàng đã có vận đơn. Hủy vận đơn cũ trước khi tạo mới.");
  }

  const senderRows = await db
    .select()
    .from(shopAddresses)
    .where(and(eq(shopAddresses.id, params.senderAddressId), eq(shopAddresses.shopId, params.shopId)))
    .limit(1);
  const sender = senderRows[0];
  if (!sender) throw badRequest("Địa chỉ lấy hàng không tồn tại.");

  const addrId = params.customerAddressId ?? order.customerAddressId;
  if (!addrId) throw badRequest("Đơn hàng chưa có địa chỉ giao hàng.");
  const customerAddrRows = await db
    .select()
    .from(customerAddresses)
    .where(eq(customerAddresses.id, addrId))
    .limit(1);
  const receiver = customerAddrRows[0];
  if (!receiver) throw badRequest("Địa chỉ giao hàng không tồn tại.");

  const items = await db
    .select({ price: orderItems.price, quantity: orderItems.quantity })
    .from(orderItems)
    .where(eq(orderItems.orderId, params.orderId));
  const subtotalAmount = items.reduce((sum, item) => sum + toMoney(item.price) * (item.quantity ?? 1), 0);
  const amounts = reconcileOrderAmounts({ ...order, subtotalAmount });
  await db.update(orders).set({ ...amounts, updatedAt: new Date() }).where(and(eq(orders.id, params.orderId), eq(orders.shopId, params.shopId)));

  const submitParams = {
    shopId: params.shopId,
    orderId: params.orderId,
    providerCode: "spx" as const,
    pickName: sender.name ?? "",
    pickTel: sender.phone ?? "",
    pickAddress: sender.address ?? "",
    pickProvince: sender.province ?? "",
    pickWard: sender.ward ?? "",
    receiverName: receiver.name ?? "",
    receiverTel: receiver.phone ?? "",
    receiverAddress: receiver.address ?? "",
    receiverProvince: receiver.province ?? "",
    receiverWard: receiver.ward ?? "",
    spxServiceType: params.serviceType,
    spxCollectType: params.collectType,
    spxPickupTimeRangeId: params.pickupTimeRangeId,
    spxPickupTime: params.pickupTime,
    parcelWeightGram: params.parcelWeightGram,
    parcelLengthCm: params.parcelLengthCm,
    parcelWidthCm: params.parcelWidthCm,
    parcelHeightCm: params.parcelHeightCm,
    parcelItemName: params.parcelItemName,
    declaredValue: params.declaredValue,
    codAmount: amounts.remainingAmount,
    voucherCode: params.voucherCode,
    note: params.note,
  };

  const provider = getShippingProviderAdapter("spx");
  const result = await provider.submit(submitParams);
  const spxResult = result as typeof result & { spxTrackingNo?: string; spxPickupTime?: number; errorCode?: string; errorMessage?: string };

  await insertShipmentAndUpdateOrder({
    orderId: params.orderId,
    shopId: params.shopId,
    providerCode: "spx",
    result,
    note: params.note,
    targetOrderStatus: result.status !== "outcome_unknown" ? "confirmed" : undefined,
    extra: {
      spxTrackingNo: spxResult.spxTrackingNo,
      serviceType: params.serviceType,
      collectType: params.collectType,
      pickupTime: spxResult.spxPickupTime,
      pickupTimeRangeId: params.pickupTimeRangeId,
      providerShippingFee: result.fee ?? undefined,
      parcelWeightGram: params.parcelWeightGram,
      parcelLengthCm: params.parcelLengthCm,
      parcelWidthCm: params.parcelWidthCm,
      parcelHeightCm: params.parcelHeightCm,
      parcelItemName: params.parcelItemName,
      declaredValue: params.declaredValue,
      senderName: sender.name ?? undefined,
      senderPhone: sender.phone ?? undefined,
      senderProvince: sender.province ?? undefined,
      senderDistrict: sender.district ?? undefined,
      senderWard: sender.ward ?? undefined,
      senderDetailAddress: sender.address ?? undefined,
      receiverName: receiver.name ?? undefined,
      receiverPhone: receiver.phone ?? undefined,
      receiverProvince: receiver.province ?? undefined,
      receiverDistrict: receiver.district ?? undefined,
      receiverWard: receiver.ward ?? undefined,
      receiverDetailAddress: receiver.address ?? undefined,
      idempotencyKey: params.idempotencyKey,
      errorCode: spxResult.errorCode,
      errorMessage: spxResult.errorMessage,
    },
  });

  return { ...result, orderId: params.orderId };
}

export async function getSpxShipmentLabel(params: { shopId: string; orderId: string }) {
  await assertOrderInShop(params.orderId, params.shopId);
  const shipmentRows = await db
    .select()
    .from(orderShipments)
    .where(eq(orderShipments.orderId, params.orderId))
    .limit(1);

  const shipment = shipmentRows[0];
  if (!shipment) throw badRequest("Đơn hàng chưa có vận đơn.");
  if (normalizeShippingProviderCode(shipment.providerCode) !== "spx") {
    throw badRequest("Vận đơn này không phải SPX.");
  }

  const trackingNo = shipment.spxTrackingNo ?? shipment.trackingLabel;
  if (!trackingNo) throw badRequest("Vận đơn SPX chưa có mã tracking.");

  const now = new Date();
  const expiresAt = shipment.labelExpiresAt;
  const needRefresh = !shipment.labelUrl || !expiresAt || expiresAt.getTime() - now.getTime() < 5 * 60 * 1000;

  if (!needRefresh) return { labelUrl: shipment.labelUrl! };

  const creds = await getSpxCredentials(params.shopId);
  const labelResult = await spxGetLabel({
    environment: creds.environment,
    userId: creds.userId,
    userSecret: creds.userSecret,
    trackingNo,
  });

  const newExpiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  await db
    .update(orderShipments)
    .set({ labelUrl: labelResult.labelUrl, labelExpiresAt: newExpiresAt, updatedAt: now })
    .where(eq(orderShipments.id, shipment.id));

  return { labelUrl: labelResult.labelUrl };
}

export async function getShippingTracking(params: { shopId: string; orderId: string }) {
  await assertOrderInShop(params.orderId, params.shopId);
  const shipmentRows = await db
    .select()
    .from(orderShipments)
    .where(eq(orderShipments.orderId, params.orderId))
    .limit(1);

  const shipment = shipmentRows[0];
  if (!shipment) throw badRequest("Đơn hàng chưa có vận đơn để tra cứu.");

  const providerCode = normalizeShippingProviderCode(shipment.providerCode);
  if (providerCode === "manual") {
    return {
      providerCode: "manual" as const,
      trackingCode: shipment.trackingLabel ?? shipment.trackingCode ?? null,
      trackingLink: shipment.trackingLink ?? null,
      status: shipment.status ?? "submitted",
      statusCode: shipment.statusCode ?? null,
      raw: shipment.rawResponse ?? null,
    };
  }

  const provider = getShippingProviderAdapter(providerCode);
  const tracking = await provider.tracking({ shopId: params.shopId, orderId: params.orderId });
  return { ...tracking, trackingLink: tracking.trackingLink ?? shipment.trackingLink ?? null };
}

export async function refreshShippingStatus(params: { shopId: string; orderId: string }) {
  await assertOrderInShop(params.orderId, params.shopId);
  const shipmentRows = await db
    .select()
    .from(orderShipments)
    .where(eq(orderShipments.orderId, params.orderId))
    .limit(1);

  const shipment = shipmentRows[0];
  if (!shipment) throw badRequest("Đơn hàng chưa có vận đơn.");

  const providerCode = normalizeShippingProviderCode(shipment.providerCode);
  if (providerCode === "manual") throw badRequest("Vận đơn thủ công không hỗ trợ refresh trạng thái.");

  const provider = getShippingProviderAdapter(providerCode);
  const tracking = await provider.tracking({ shopId: params.shopId, orderId: params.orderId });

  const now = new Date();
  await db
    .update(orderShipments)
    .set({
      status: tracking.status,
      statusCode: tracking.statusCode ?? null,
      statusRaw: tracking.statusCode ?? null,
      ...(tracking.trackingLink ? { trackingLink: tracking.trackingLink } : {}),
      updatedAt: now,
    })
    .where(eq(orderShipments.id, shipment.id));
  await db
    .update(orders)
    .set({ shippingStatus: tracking.status, updatedAt: now })
    .where(eq(orders.id, shipment.orderId));

  return { ...tracking, trackingLink: tracking.trackingLink ?? shipment.trackingLink ?? null };
}

export async function getSpxTimeslots(params: { shopId: string; serviceType?: number }) {
  const { spxGetTimeslots } = await import("./providers/spx.service.js");
  const creds = await getSpxCredentials(params.shopId);
  return spxGetTimeslots({ environment: creds.environment, userId: creds.userId, userSecret: creds.userSecret, serviceType: params.serviceType });
}

export type SubmitManualShippingParams = {
  shopId: string;
  orderId: string;
  paymentSide: 0 | 1;
  shippingFee?: number;
  codAmount?: number;
  note?: string;
};

async function generateManualTrackingLabel(): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const suffix = Math.floor(Math.random() * 1_000_000).toString().padStart(6, "0");
    const label = `Lumi-${suffix}`;
    const existing = await db
      .select({ id: orderShipments.id })
      .from(orderShipments)
      .where(eq(orderShipments.trackingLabel, label))
      .limit(1);
    if (existing.length === 0) return label;
  }
  throw new Error("Failed to generate unique manual tracking label after 10 attempts");
}

export async function submitManualShipping(params: SubmitManualShippingParams) {
  const order = await assertOrderInShop(params.orderId, params.shopId);
  if ((order.status ?? "") !== "draft") {
    throw badRequest(`Không thể tạo vận đơn cho đơn hàng ở trạng thái "${order.status}".`);
  }

  const currentShipment = await getCurrentShipment(params.orderId);
  if (currentShipment && hasActiveShipment(currentShipment.status)) {
    throw badRequest("Đơn hàng đã có vận đơn. Hủy vận đơn cũ trước khi tạo mới.");
  }

  const trackingLabel = await generateManualTrackingLabel();

  const result = {
    providerCode: "manual" as const,
    trackingLabel,
    trackingCode: trackingLabel,
    externalOrderId: null,
    fee: params.shippingFee ?? null,
    status: "submitted" as const,
    statusCode: null,
    statusRaw: null,
    paymentSide: params.paymentSide,
    rawResponse: { provider: "manual" } as Record<string, unknown>,
  };

  await insertShipmentAndUpdateOrder({
    orderId: params.orderId,
    shopId: params.shopId,
    providerCode: "manual",
    result,
    note: params.note,
  });

  if (params.codAmount !== undefined) {
    await db
      .update(orders)
      .set({ codAmount: params.codAmount, updatedAt: new Date() })
      .where(and(eq(orders.id, params.orderId), eq(orders.shopId, params.shopId)));
  }

  return { ...result, orderId: params.orderId };
}

export async function cancelShipment(params: { shopId: string; orderId: string; trackingId?: string; reason?: string }) {
  const order = await assertOrderInShop(params.orderId, params.shopId);
  const shipment = await getCurrentShipment(params.orderId);
  if (!shipment) throw badRequest("Đơn hàng chưa có vận đơn để hủy.");

  const providerCode = normalizeShippingProviderCode(shipment.providerCode);
  if (providerCode === "manual") {
    const cancelledAt = new Date();
    await db
      .update(orderShipments)
      .set({ status: "cancelled", cancelledAt, cancelReason: params.reason ?? null, updatedAt: cancelledAt })
      .where(eq(orderShipments.id, shipment.id));
    await db.update(orders).set({ shippingStatus: "cancelled", updatedAt: cancelledAt }).where(eq(orders.id, order.id));
    return { providerCode: "manual", status: "cancelled", logId: null };
  }

  if (providerCode === "spx" && shipment.status !== "pending_pickup") {
    throw badRequest(`Chỉ có thể hủy vận đơn SPX ở trạng thái chờ lấy hàng (hiện tại: ${shipment.status}).`);
  }

  const provider = getShippingProviderAdapter(providerCode);
  const result = await provider.cancel({ shopId: params.shopId, orderId: params.orderId, trackingId: params.trackingId ?? shipment.spxTrackingNo ?? shipment.trackingLabel ?? shipment.trackingCode ?? undefined });
  const cancelledAt = new Date();
  await db
    .update(orderShipments)
    .set({ status: result.status ?? "cancelled", cancelledAt, cancelReason: params.reason ?? null, updatedAt: cancelledAt })
    .where(eq(orderShipments.id, shipment.id));
  await db.update(orders).set({ shippingStatus: result.status ?? "cancelled", updatedAt: cancelledAt }).where(eq(orders.id, order.id));
  return result;
}
