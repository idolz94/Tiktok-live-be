import { eq, and, inArray, sql, gte, lt } from "drizzle-orm";
import { db } from "../lib/db.js";
import { orders, orderItems, orderShipments, customerAddresses } from "../db/schema/index.js";
import { badRequest, notFound } from "../lib/api-error.js";
import { getCommentAvatar, getCommentDisplayName, getCommentText } from "../utils/comment.js";
import { createOrderCode } from "../utils/id.js";
import { getCommentTikTokUsername } from "../utils/tiktok.js";
import { findOrCreateCustomer, updateCustomerAfterOrder } from "./customer.service.js";
import { findDbLiveCommentId, updateLiveCommentOrder } from "./live-comments.service.js";
import { updateLiveSessionOrderCount } from "./live-sessions.service.js";
import { matchPresetByComment } from "./product-presets.service.js";
import { getCurrentLicense } from "./license.service.js";
import { getShippingProviderAdapter, normalizeShippingProviderCode } from "./providers/registry.js";

async function assertOrderLimitNotExceeded(shopId: string) {
  const license = await getCurrentLicense(shopId);
  const limit = license?.maxOrdersPerMonth ?? null;
  if (limit === null) return;

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(orders)
    .where(and(eq(orders.shopId, shopId), gte(orders.createdAt, monthStart), lt(orders.createdAt, monthEnd)));

  const used = row?.count ?? 0;
  if (used >= limit) {
    throw badRequest(
      `Shop đã tạo ${used}/${limit} đơn trong tháng này. Vui lòng nâng cấp gói để tiếp tục.`,
    );
  }
}

async function generateUniqueOrderCode(): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = createOrderCode();
    const existing = await db.select({ id: orders.id }).from(orders).where(eq(orders.orderCode, code)).limit(1);
    if (existing.length === 0) return code;
  }
  throw new Error("Failed to generate unique order code after 10 attempts");
}

const DEFAULT_PRICE = 20000;
const DEFAULT_QUANTITY = 1;

function toMoney(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function reconcileOrderAmounts(order: {
  subtotalAmount?: number | null;
  shippingFee?: number | null;
  discountAmount?: number | null;
  depositAmount?: number | null;
  codAmount?: number | null;
}) {
  const subtotalAmount = toMoney(order.subtotalAmount);
  const shippingFee = toMoney(order.shippingFee);
  const discountAmount = toMoney(order.discountAmount);
  const depositAmount = toMoney(order.depositAmount);
  const codAmount = toMoney(order.codAmount);
  const totalAmount = Math.max(0, subtotalAmount + shippingFee - discountAmount);
  const remainingAmount = Math.max(0, totalAmount - depositAmount);
  return { subtotalAmount, shippingFee, discountAmount, depositAmount, codAmount, totalAmount, remainingAmount };
}

async function updateOrderAmounts(orderId: string, shopId: string) {
  const [order] = await db.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.shopId, shopId))).limit(1);
  if (!order) throw notFound("Không tìm thấy đơn hàng.");
  const amounts = reconcileOrderAmounts(order);
  await db.update(orders).set({ ...amounts, updatedAt: new Date() }).where(and(eq(orders.id, orderId), eq(orders.shopId, shopId)));
}

async function attachProducts<T extends { id: string; customerAddressId?: string | null }>(orderRows: T[]): Promise<(T & { products: (typeof orderItems.$inferSelect)[]; shipment: typeof orderShipments.$inferSelect | null; customerAddressData: typeof customerAddresses.$inferSelect | null })[]> {
  if (!orderRows.length) return orderRows.map((o) => ({ ...o, products: [], shipment: null, customerAddressData: null }));

  const orderIds = orderRows.map((o) => o.id);
  const addressIds = [...new Set(orderRows.map((o) => o.customerAddressId).filter(Boolean) as string[])];

  const [items, shipmentRows, addressRows] = await Promise.all([
    db.select().from(orderItems).where(inArray(orderItems.orderId, orderIds)),
    db.select().from(orderShipments).where(inArray(orderShipments.orderId, orderIds)),
    addressIds.length
      ? db.select().from(customerAddresses).where(inArray(customerAddresses.id, addressIds))
      : Promise.resolve([]),
  ]);

  const byOrderId = new Map<string, (typeof orderItems.$inferSelect)[]>();
  for (const item of items) {
    const list = byOrderId.get(item.orderId) ?? [];
    list.push(item);
    byOrderId.set(item.orderId, list);
  }

  const shipmentByOrderId = new Map<string, typeof orderShipments.$inferSelect>();
  for (const s of shipmentRows) {
    shipmentByOrderId.set(s.orderId, s);
  }

  const addressById = new Map<string, typeof customerAddresses.$inferSelect>();
  for (const a of addressRows) {
    addressById.set(a.id, a);
  }

  return orderRows.map((o) => ({
    ...o,
    products: byOrderId.get(o.id) ?? [],
    shipment: shipmentByOrderId.get(o.id) ?? null,
    customerAddressData: o.customerAddressId ? (addressById.get(o.customerAddressId) ?? null) : null,
  }));
}

export async function listOrders(shopId: string, shippingStatus?: string) {
  const condition = shippingStatus
    ? and(eq(orders.shopId, shopId), eq(orders.shippingStatus, shippingStatus))
    : eq(orders.shopId, shopId);

  const rows = await db
    .select()
    .from(orders)
    .where(condition)
    .orderBy(sql`${orders.createdAt} desc`);

  return attachProducts(rows);
}

export async function createOrderFromComment({
  shopId,
  userId,
  comment,
  liveSessionId,
  price = DEFAULT_PRICE,
  quantity = DEFAULT_QUANTITY,
  note = "",
}: {
  shopId: string;
  userId: string;
  comment: Record<string, unknown>;
  liveSessionId?: string | null;
  price?: number;
  quantity?: number;
  note?: string;
}) {
  await assertOrderLimitNotExceeded(shopId);

  const commentText = getCommentText(comment);
  const customerTiktokUsername = getCommentTikTokUsername(comment);
  const displayName = getCommentDisplayName(comment);
  const avatarUrl = getCommentAvatar(comment);

  if (!commentText) throw badRequest("Comment không có nội dung để tạo đơn.");

  const preset = await matchPresetByComment(shopId, commentText);
  const safePrice = preset ? preset.price : Number.isFinite(Number(price)) ? Number(price) : DEFAULT_PRICE;
  const safeQuantity = Number.isFinite(Number(quantity)) ? Number(quantity) : DEFAULT_QUANTITY;

  const customer = await findOrCreateCustomer({ shopId, tiktokUsername: customerTiktokUsername, displayName, avatarUrl });

  const defaultAddress = customer?.id
    ? await db
        .select({ id: customerAddresses.id })
        .from(customerAddresses)
        .where(and(eq(customerAddresses.customerId, customer.id), eq(customerAddresses.isDefault, true)))
        .limit(1)
        .then((rows) => rows[0] ?? null)
    : null;

  const subtotalAmount = safePrice * safeQuantity;
  const amounts = reconcileOrderAmounts({ subtotalAmount, shippingFee: 0, discountAmount: 0, depositAmount: 0, codAmount: 0 });
  const liveCommentId = await findDbLiveCommentId({ shopId, comment });

  const [order] = await db
    .insert(orders)
    .values({
      shopId,
      customerId: customer?.id ?? null,
      liveSessionId: liveSessionId ?? null,
      liveCommentId: liveCommentId ?? null,
      orderCode: await generateUniqueOrderCode(),
      source: "live_comment",
      customerName: displayName,
      customerTiktokUsername,
      customerPhone: "",
      customerAddress: "",
      customerAvatarUrl: avatarUrl ?? null,
      customerAddressId: defaultAddress?.id ?? null,
      commentText,
      color: preset?.color ?? null,
      status: "draft",
      depositStatus: "unpaid",
      paymentStatus: "unpaid",
      shippingStatus: "not_shipped",
      ...amounts,
      note,
      createdBy: userId,
    })
    .returning();

  await db.insert(orderItems).values({
    orderId: order.id,
    shopId,
    productCode: preset?.code ?? "",
    productName: preset?.name ?? commentText,
    variantName: "",
    color: preset?.color ?? "",
    size: "",
    quantity: safeQuantity,
    price: safePrice,
    rawCommentText: commentText,
  });

  void Promise.all([
    updateLiveCommentOrder({ commentId: liveCommentId, orderId: order.id }),
    updateLiveSessionOrderCount(liveSessionId ?? null),
    updateCustomerAfterOrder({ customerId: customer?.id ?? null, totalAmount: amounts.totalAmount }),
  ]).catch((err) => {
    console.error("CREATE_ORDER_FROM_COMMENT_SIDE_EFFECT_FAILED", err);
  });

  return {
    success: true,
    message: "Tạo đơn thành công.",
    orderId: order.id,
    orderCode: order.orderCode,
    presetMatched: preset ? { code: preset.code, name: preset.name, color: preset.color, price: preset.price } : null,
  };
}

async function assertOrderInShop(orderId: string, shopId: string) {
  const rows = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.shopId, shopId)))
    .limit(1);

  const row = rows[0];
  if (!row) throw notFound("Không tìm thấy đơn hàng.");
  return row;
}

export async function __getOrderForShipping(orderId: string, shopId: string) {
  const order = await assertOrderInShop(orderId, shopId);
  const [shipmentRows, addressRows, items] = await Promise.all([
    db.select().from(orderShipments).where(eq(orderShipments.orderId, orderId)).limit(1),
    order.customerAddressId
      ? db.select().from(customerAddresses).where(eq(customerAddresses.id, order.customerAddressId)).limit(1)
      : Promise.resolve([]),
    db.select().from(orderItems).where(eq(orderItems.orderId, orderId)),
  ]);

  return {
    ...order,
    shipment: shipmentRows[0] ?? null,
    customerAddressData: addressRows[0] ?? null,
    items,
  };
}

export async function getOrderForShop(orderId: string, shopId: string) {
  const order = await assertOrderInShop(orderId, shopId);
  const [shipmentRows, addressRows] = await Promise.all([
    db.select().from(orderShipments).where(eq(orderShipments.orderId, orderId)).limit(1),
    order.customerAddressId
      ? db.select().from(customerAddresses).where(eq(customerAddresses.id, order.customerAddressId)).limit(1)
      : Promise.resolve([]),
  ]);
  return {
    ...order,
    shipment: shipmentRows[0] ?? null,
    customerAddressData: addressRows[0] ?? null,
  };
}

export async function updateOrderDepositStatus({
  shopId,
  orderId,
  depositStatus,
}: {
  shopId: string;
  orderId: string;
  depositStatus: string;
}) {
  await assertOrderInShop(orderId, shopId);

  const paymentStatus =
    depositStatus === "paid"
      ? "paid"
      : depositStatus === "deposited"
        ? "partial"
        : depositStatus === "refunded"
          ? "refunded"
          : "unpaid";

  const [updated] = await db
    .update(orders)
    .set({ depositStatus, paymentStatus, updatedAt: new Date() })
    .where(and(eq(orders.id, orderId), eq(orders.shopId, shopId)))
    .returning();

  const [items, addressRows] = await Promise.all([
    db.select().from(orderItems).where(eq(orderItems.orderId, orderId)),
    updated.customerAddressId
      ? db.select().from(customerAddresses).where(eq(customerAddresses.id, updated.customerAddressId)).limit(1)
      : Promise.resolve([]),
  ]);
  return { ...updated, products: items, customerAddressData: addressRows[0] ?? null };
}

export async function updateOrderStatus({
  shopId,
  orderId,
  status,
}: {
  shopId: string;
  orderId: string;
  status: string;
}) {
  await assertOrderInShop(orderId, shopId);

  const patch: Record<string, unknown> = { status, updatedAt: new Date() };
  if (status === "confirmed") patch.confirmedAt = new Date();
  if (status === "canceled") patch.canceledAt = new Date();

  const [updated] = await db
    .update(orders)
    .set(patch)
    .where(and(eq(orders.id, orderId), eq(orders.shopId, shopId)))
    .returning();

  const [items, addressRows] = await Promise.all([
    db.select().from(orderItems).where(eq(orderItems.orderId, orderId)),
    updated.customerAddressId
      ? db.select().from(customerAddresses).where(eq(customerAddresses.id, updated.customerAddressId)).limit(1)
      : Promise.resolve([]),
  ]);
  return { ...updated, products: items, customerAddressData: addressRows[0] ?? null };
}

export async function updateOrder({
  shopId,
  orderId,
  customerAddressId,
  note,
  color,
  codAmount,
}: {
  shopId: string;
  orderId: string;
  customerAddressId?: string | null;
  note?: string;
  color?: string | null;
  codAmount?: number;
}) {
  await assertOrderInShop(orderId, shopId);

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (customerAddressId !== undefined) patch.customerAddressId = customerAddressId || null;
  if (note !== undefined) patch.note = note;
  if (color !== undefined) patch.color = color || null;
  if (codAmount !== undefined) patch.codAmount = codAmount;

  const [updated] = await db
    .update(orders)
    .set(patch)
    .where(and(eq(orders.id, orderId), eq(orders.shopId, shopId)))
    .returning();

  return updated;
}

export async function deleteOrder({ shopId, orderId }: { shopId: string; orderId: string }) {
  await assertOrderInShop(orderId, shopId);
  await db.delete(orders).where(and(eq(orders.id, orderId), eq(orders.shopId, shopId)));
  return { ok: true };
}

export async function addOrderItem({
  shopId,
  orderId,
  productCode,
  productName,
  price,
  quantity,
}: {
  shopId: string;
  orderId: string;
  productCode?: string;
  productName?: string;
  price: number;
  quantity: number;
}) {
  await assertOrderInShop(orderId, shopId);

  const safePrice = Number.isFinite(Number(price)) && price >= 0 ? Number(price) : 0;
  const safeQty = Number.isInteger(quantity) && quantity > 0 ? quantity : 1;

  const [item] = await db
    .insert(orderItems)
    .values({
      orderId,
      shopId,
      productCode: productCode ?? "",
      productName: productName ?? productCode ?? "",
      variantName: "",
      color: "",
      size: "",
      quantity: safeQty,
      price: safePrice,
      rawCommentText: "",
    })
    .returning();

  const allItems = await db
    .select({ price: orderItems.price, quantity: orderItems.quantity })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));

  const subtotal = allItems.reduce((sum, i) => sum + (i.price ?? 0) * (i.quantity ?? 1), 0);

  await db
    .update(orders)
    .set({ subtotalAmount: subtotal, updatedAt: new Date() })
    .where(and(eq(orders.id, orderId), eq(orders.shopId, shopId)));
  await updateOrderAmounts(orderId, shopId);

  return item;
}

export async function updateOrderItem({
  shopId,
  orderId,
  itemId,
  productCode,
  productName,
  price,
  quantity,
}: {
  shopId: string;
  orderId: string;
  itemId: string;
  productCode?: string;
  productName?: string;
  price?: number;
  quantity?: number;
}) {
  await assertOrderInShop(orderId, shopId);

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (productCode !== undefined) updates.productCode = productCode;
  if (productName !== undefined) updates.productName = productName;
  if (price !== undefined && Number.isFinite(price) && price >= 0) updates.price = price;
  if (quantity !== undefined && Number.isInteger(quantity) && quantity > 0) updates.quantity = quantity;

  const [item] = await db
    .update(orderItems)
    .set(updates)
    .where(and(eq(orderItems.id, itemId), eq(orderItems.orderId, orderId), eq(orderItems.shopId, shopId)))
    .returning();

  if (!item) throw notFound("Không tìm thấy sản phẩm trong đơn hàng.");

  const allItems = await db
    .select({ price: orderItems.price, quantity: orderItems.quantity })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));

  const subtotal = allItems.reduce((sum, i) => sum + (i.price ?? 0) * (i.quantity ?? 1), 0);

  await db
    .update(orders)
    .set({ subtotalAmount: subtotal, updatedAt: new Date() })
    .where(and(eq(orders.id, orderId), eq(orders.shopId, shopId)));
  await updateOrderAmounts(orderId, shopId);

  return item;
}

export async function removeOrderItem({
  shopId,
  orderId,
  itemId,
}: {
  shopId: string;
  orderId: string;
  itemId: string;
}) {
  await assertOrderInShop(orderId, shopId);

  await db
    .delete(orderItems)
    .where(and(eq(orderItems.id, itemId), eq(orderItems.orderId, orderId), eq(orderItems.shopId, shopId)));

  const allItems = await db
    .select({ price: orderItems.price, quantity: orderItems.quantity })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));

  const subtotal = allItems.reduce((sum, i) => sum + (i.price ?? 0) * (i.quantity ?? 1), 0);

  await db
    .update(orders)
    .set({ subtotalAmount: subtotal, updatedAt: new Date() })
    .where(and(eq(orders.id, orderId), eq(orders.shopId, shopId)));
  await updateOrderAmounts(orderId, shopId);

  return { ok: true };
}

export type GetShippingFeeParams = {
  shopId: string;
  orderId: string;
  providerCode?: string;
  pickProvince: string;
  pickDistrict: string;
  pickWard?: string;
  pickAddress?: string;
  receiverProvince: string;
  receiverDistrict: string;
  receiverWard?: string;
  receiverAddress?: string;
  weight?: number;
  transport?: "road" | "fly";
};
export async function getShippingFee(params: GetShippingFeeParams) {
  await assertOrderInShop(params.orderId, params.shopId);
  const provider = getShippingProviderAdapter(params.providerCode ?? "ghtk");

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

async function insertShipmentAndUpdateOrder({
  orderId,
  shopId,
  providerCode,
  result,
  note,
}: {
  orderId: string;
  shopId: string;
  providerCode: string;
  result: Awaited<ReturnType<ReturnType<typeof getShippingProviderAdapter>["submit"]>>;
  note?: string;
}) {
  const patch: Record<string, unknown> = {
    providerCode: result.providerCode,
    shippingFee: result.fee ?? undefined,
    shippingStatus: result.status ?? "submitted",
    status: "packed",
    updatedAt: new Date(),
  };
  if (result.labelPaperSize !== undefined) patch["labelPaperSize"] = result.labelPaperSize;
  if (note !== undefined) patch["note"] = note;

  await db.insert(orderShipments).values({
    orderId,
    shopId,
    providerCode: providerCode,
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
    paymentSide: result.paymentSide ?? null,
    rawResponse: result.rawResponse as Record<string, unknown> | null,
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

  const provider = getShippingProviderAdapter(params.providerCode ?? "ghtk");
  const result = await provider.submit(params);
  await insertShipmentAndUpdateOrder({
    orderId: params.orderId,
    shopId: params.shopId,
    providerCode: result.providerCode,
    result,
    note: params.note,
  });

  return { ...result, orderId: params.orderId };
}

export async function submitOrderToGhtk(params: SubmitShippingParams) {
  return createShipment({ ...params, providerCode: "ghtk" });
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
      providerCode: "manual",
      trackingCode: shipment.trackingLabel ?? shipment.trackingCode ?? null,
      status: shipment.status ?? "submitted",
      statusCode: shipment.statusCode ?? null,
      raw: shipment.rawResponse ?? null,
    };
  }

  const provider = getShippingProviderAdapter(providerCode);
  return provider.tracking({ shopId: params.shopId, orderId: params.orderId });
}

export type SubmitManualShippingParams = {
  shopId: string;
  orderId: string;
  trackingCode: string;
  providerName?: string;
  shippingFee?: number;
  note?: string;
};

export async function submitManualShipping(params: SubmitManualShippingParams) {
  const order = await assertOrderInShop(params.orderId, params.shopId);
  if ((order.status ?? "") !== "draft") {
    throw badRequest(`Không thể tạo vận đơn cho đơn hàng ở trạng thái "${order.status}".`);
  }

  const currentShipment = await getCurrentShipment(params.orderId);
  if (currentShipment && hasActiveShipment(currentShipment.status)) {
    throw badRequest("Đơn hàng đã có vận đơn. Hủy vận đơn cũ trước khi tạo mới.");
  }

  const result = {
    providerCode: "manual" as const,
    trackingLabel: params.trackingCode,
    trackingCode: params.trackingCode,
    externalOrderId: null,
    fee: params.shippingFee ?? null,
    status: "submitted" as const,
    statusCode: null,
    statusRaw: null,
    rawResponse: { provider: "manual", providerName: params.providerName ?? "Thủ công" } as Record<string, unknown>,
  };

  await insertShipmentAndUpdateOrder({
    orderId: params.orderId,
    shopId: params.shopId,
    providerCode: "manual",
    result,
    note: params.note,
  });

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

  const provider = getShippingProviderAdapter(providerCode);
  const result = await provider.cancel({ shopId: params.shopId, orderId: params.orderId, trackingId: params.trackingId ?? shipment.trackingLabel ?? shipment.trackingCode ?? undefined });
  const cancelledAt = new Date();
  await db
    .update(orderShipments)
    .set({ status: result.status ?? "cancelled", cancelledAt, cancelReason: params.reason ?? null, updatedAt: cancelledAt })
    .where(eq(orderShipments.id, shipment.id));
  await db.update(orders).set({ shippingStatus: result.status ?? "cancelled", updatedAt: cancelledAt }).where(eq(orders.id, order.id));
  return result;
}
