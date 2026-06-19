import { eq, and, inArray, sql, gte, lt } from "drizzle-orm";
import { db } from "../lib/db.js";
import { orders, orderItems, orderShipments, customerAddresses } from "../db/schema/index.js";
import { badRequest, notFound } from "../lib/api-error.js";
import { getCommentAvatar, getCommentDisplayName, getCommentText } from "../utils/comment.js";
import { createOrderCode, isUuid } from "../utils/id.js";
import { getCommentTikTokUsername } from "../utils/tiktok.js";
import { findOrCreateCustomer, updateCustomerAfterOrder } from "./customer.service.js";
import { findDbLiveCommentId, updateLiveCommentOrder } from "./live-comments.service.js";
import { updateLiveSessionOrderCount } from "./live-sessions.service.js";
import { matchPresetByComment } from "./product-presets.service.js";
import { getGhtkToken, ghtkSubmitOrder, ghtkGetFee, ghtkGetTracking } from "./providers/ghtk.service.js";
import type { GhtkSubmitOrderParams } from "./providers/ghtk.service.js";
import { getCurrentLicense } from "./license.service.js";

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

async function attachProducts<T extends { id: string; customerAddressId?: string | null }>(orderRows: T[]): Promise<(T & { products: any[]; shipment: any | null; customerAddressData: any | null })[]> {
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

  const byOrderId = new Map<string, any[]>();
  for (const item of items) {
    const list = byOrderId.get(item.orderId) ?? [];
    list.push(item);
    byOrderId.set(item.orderId, list);
  }

  const shipmentByOrderId = new Map<string, any>();
  for (const s of shipmentRows) {
    shipmentByOrderId.set(s.orderId, s);
  }

  const addressById = new Map<string, any>();
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
  comment: any;
  liveSessionId?: string | null;
  price?: number;
  quantity?: number;
  note?: string;
}) {
  await assertOrderLimitNotExceeded(shopId);

  const commentText = getCommentText(comment);
  const customerTikTokUsername = getCommentTikTokUsername(comment);
  const displayName = getCommentDisplayName(comment);
  const avatarUrl = getCommentAvatar(comment);

  if (!commentText) throw badRequest("Comment không có nội dung để tạo đơn.");

  const preset = await matchPresetByComment(shopId, commentText);

  const safePrice = preset
    ? preset.price
    : Number.isFinite(Number(price)) ? Number(price) : DEFAULT_PRICE;
  const safeQuantity = Number.isFinite(Number(quantity)) ? Number(quantity) : DEFAULT_QUANTITY;

  const customer = await findOrCreateCustomer({ shopId, tiktokUsername: customerTikTokUsername, displayName, avatarUrl });

  const defaultAddress = customer?.id
    ? await db
        .select({ id: customerAddresses.id })
        .from(customerAddresses)
        .where(and(eq(customerAddresses.customerId, customer.id), eq(customerAddresses.isDefault, true)))
        .limit(1)
        .then((rows) => rows[0] ?? null)
    : null;

  const subtotalAmount = safePrice * safeQuantity;
  const totalAmount = subtotalAmount;
  const liveCommentId = await findDbLiveCommentId({ shopId, comment });
  const dbLiveSessionId = isUuid(liveSessionId) ? liveSessionId : null;

  const [order] = await db
    .insert(orders)
    .values({
      shopId,
      customerId: customer?.id ?? null,
      liveSessionId: dbLiveSessionId as string | undefined,
      liveCommentId: liveCommentId as string | undefined,
      orderCode: await generateUniqueOrderCode(),
      source: "live_comment",
      customerName: displayName,
      customerTiktokUsername: customerTikTokUsername,
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
      subtotalAmount,
      shippingFee: 0,
      discountAmount: 0,
      totalAmount,
      depositAmount: 0,
      codAmount: 0,
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
    updateLiveSessionOrderCount(dbLiveSessionId),
    updateCustomerAfterOrder({ customerId: customer?.id ?? null, totalAmount }),
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

  const updates: Record<string, any> = { updatedAt: new Date() };
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

  return { ok: true };
}

export type GetShippingFeeParams = {
  shopId: string;
  orderId: string;
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
  const order = await assertOrderInShop(params.orderId, params.shopId);

  const token = await getGhtkToken(params.shopId);
  if (!token) throw badRequest("Shop chưa cấu hình token GHTK.");

  return ghtkGetFee({
    token,
    pickProvince: params.pickProvince,
    pickDistrict: params.pickDistrict,
    pickWard: params.pickWard,
    pickAddress: params.pickAddress,
    province: params.receiverProvince,
    district: params.receiverDistrict,
    ward: params.receiverWard,
    address: params.receiverAddress,
    weight: params.weight ?? 300,
    value: order.totalAmount ?? 0,
    transport: params.transport,
  });
}

export type SubmitShippingParams = {
  shopId: string;
  orderId: string;
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

export async function submitOrderToGhtk(params: SubmitShippingParams) {
  const order = await assertOrderInShop(params.orderId, params.shopId);

  const token = await getGhtkToken(params.shopId);
  if (!token) {
    throw badRequest("Shop chưa cấu hình token GHTK. Vui lòng vào cài đặt để thêm token.");
  }

  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, params.orderId));
  if (!items.length) {
    throw badRequest("Đơn hàng chưa có sản phẩm để đăng lên GHTK.");
  }

  const ghtkProducts = items.map((item) => ({
    name: item.productName ?? item.productCode ?? "Sản phẩm",
    weight: 0.3,
    quantity: item.quantity ?? 1,
    product_code: item.productCode ?? undefined,
  }));

  const submitParams: GhtkSubmitOrderParams = {
    token,
    order: {
      id: order.orderCode ?? order.id,
      pickName: params.pickName,
      pickAddress: params.pickAddress || [params.pickWard, params.pickDistrict, params.pickProvince].filter(Boolean).join(", "),
      pickProvince: params.pickProvince,
      pickDistrict: params.pickDistrict,
      pickWard: params.pickWard,
      pickTel: params.pickTel,
      name: params.receiverName,
      address: params.receiverAddress || [params.receiverWard, params.receiverDistrict, params.receiverProvince].filter(Boolean).join(", "),
      province: params.receiverProvince,
      district: params.receiverDistrict,
      ward: params.receiverWard,
      hamlet: params.receiverHamlet,
      tel: params.receiverTel,
      note: params.note ?? order.note ?? "",
      pickMoney: order.subtotalAmount ?? 0,
      value: order.totalAmount ?? 0,
      isFreeShip: params.isFreeShip ?? 0,
      transport: params.transport ?? "road",
      pickOption: params.pickOption ?? "cod",
    },
    products: ghtkProducts,
  };

  const result = await ghtkSubmitOrder(submitParams);

  // Write into order_shipments (polymorphic)
  await db.insert(orderShipments).values({
    orderId: params.orderId,
    shopId: params.shopId,
    providerCode: "GHTK",
    trackingLabel: result.label,
    externalOrderId: String(result.trackingId),
    fee: result.fee,
    statusCode: String(result.statusId),
    submittedAt: new Date(),
    estimatedPickTime: result.estimatedPickTime ?? null,
    estimatedDeliverTime: result.estimatedDeliverTime ?? null,
    rawResponse: result as unknown as Record<string, unknown>,
  });

  // Update order-level fields
  await db
    .update(orders)
    .set({
      providerCode: "GHTK",
      shippingFee: result.fee,
      shippingStatus: "submitted",
      updatedAt: new Date(),
    })
    .where(and(eq(orders.id, params.orderId), eq(orders.shopId, params.shopId)));

  return { ...result, orderId: params.orderId };
}

export async function getShippingTracking(params: { shopId: string; orderId: string }) {
  const order = await assertOrderInShop(params.orderId, params.shopId);

  const shipmentRows = await db
    .select()
    .from(orderShipments)
    .where(eq(orderShipments.orderId, params.orderId))
    .limit(1);

  const shipment = shipmentRows[0];

  if (shipment?.providerCode === "MANUAL") {
    return {
      provider: "MANUAL",
      trackingCode: shipment.trackingLabel ?? null,
      submittedAt: shipment.submittedAt ?? null,
      fee: shipment.fee ?? null,
    };
  }

  const trackingOrder = shipment?.trackingLabel ?? order.orderCode;
  if (!trackingOrder) throw badRequest("Đơn hàng chưa có mã vận đơn để tra cứu.");

  const token = await getGhtkToken(params.shopId);
  if (!token) throw badRequest("Shop chưa cấu hình token GHTK.");

  return ghtkGetTracking({ token, trackingOrder, partnerCode: undefined });
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

  const allowedStatuses = ["draft", "confirmed", "packed"];
  if (!allowedStatuses.includes(order.status ?? "")) {
    throw badRequest(`Không thể tạo vận đơn cho đơn hàng ở trạng thái "${order.status}".`);
  }

  const existing = await db
    .select({ id: orderShipments.id })
    .from(orderShipments)
    .where(eq(orderShipments.orderId, params.orderId))
    .limit(1);

  if (existing.length) {
    throw badRequest("Đơn hàng đã có vận đơn. Hủy vận đơn cũ trước khi tạo mới.");
  }

  await db.insert(orderShipments).values({
    orderId: params.orderId,
    shopId: params.shopId,
    providerCode: "MANUAL",
    trackingLabel: params.trackingCode,
    externalOrderId: null,
    fee: params.shippingFee ? Math.round(params.shippingFee) : null,
    statusCode: "submitted",
    submittedAt: new Date(),
    rawResponse: {
      provider: "MANUAL",
      providerName: params.providerName ?? "Thủ công",
      note: params.note ?? null,
    } as unknown as Record<string, unknown>,
  });

  const patch: Record<string, unknown> = {
    providerCode: "MANUAL",
    shippingStatus: "submitted",
    updatedAt: new Date(),
  };
  if (params.shippingFee !== undefined) patch.shippingFee = params.shippingFee;
  if (params.note !== undefined && order.note === null) patch.note = params.note;

  await db
    .update(orders)
    .set(patch)
    .where(and(eq(orders.id, params.orderId), eq(orders.shopId, params.shopId)));

  return {
    orderId: params.orderId,
    trackingCode: params.trackingCode,
    providerName: params.providerName ?? "Thủ công",
    shippingStatus: "submitted",
  };
}
