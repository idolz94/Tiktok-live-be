import { eq, and, inArray, sql, gte, lt } from "drizzle-orm";
import { db, type DbOrTx } from "../lib/db.js";
import { orders, orderItems, orderShipments, shipmentEvents, customerAddresses, customers, liveComments } from "../db/schema/index.js";
import { badRequest, notFound } from "../lib/api-error.js";
import { getCommentAvatar, getCommentDisplayName, getCommentText } from "../utils/comment.js";
import { createOrderCode } from "../utils/id.js";
import { getCommentTikTokUsername } from "../utils/tiktok.js";
import { findOrCreateCustomer, listCustomerOrders, updateCustomerAfterOrder, decrementCustomerAfterOrderDelete } from "./customer.service.js";
import { findDbLiveCommentId, updateLiveCommentOrder } from "./live-comments.service.js";
import { updateLiveSessionOrderCount } from "./live-sessions.service.js";
import { matchPresetByComment, getProductPresetByCode } from "./product-presets.service.js";
import { getCurrentLicense } from "./license.service.js";
import logger from "../lib/logger.js";

const DEFAULT_QUANTITY = 1;
const SPX_EDIT_EVENT_TYPE = "spx_order_updated";
const SPX_EDIT_LIMIT = 3;

export function parseQuantityFromComment(commentText: string) {
  const match = commentText.match(/(?:^|\s)(?:x|sl|số lượng)\s*(\d+)\b/i);
  return match ? Number(match[1]) : DEFAULT_QUANTITY;
}

/** ponytail: parse patterns like 695k, 695K, 695.000, 695,000 from comment text */
export function parsePriceFromComment(commentText: string): number | null {
  // Try `<number>k` first (unambiguous price signal)
  const kMatch = commentText.match(/\b(\d{1,3}(?:[.,]\d{3})*|\d+)[kK]\b/);
  if (kMatch) {
    const value = Number(kMatch[1].replace(/[.,]/g, "")) * 1000;
    return value >= 1000 && value <= 100_000_000 ? value : null;
  }
  // Fallback: formatted thousands number like 695.000 or 695,000
  const fmtMatch = commentText.match(/\b(\d{1,3})([.,])(\d{3})\b/);
  if (fmtMatch) {
    const value = Number(fmtMatch[1] + fmtMatch[3]);
    return value >= 1000 && value <= 100_000_000 ? value : null;
  }
  // Bare large number >= 1000 (e.g. 695000)
  const bareMatch = commentText.match(/\b(\d{5,9})\b/);
  if (bareMatch) {
    const value = Number(bareMatch[1]);
    return value >= 1000 && value <= 100_000_000 ? value : null;
  }
  return null;
}

/** ponytail: fallback price when no preset matches — parsed price, else first number ×1000 (≤100k), else 20000 */
export function resolveFallbackCommentPrice(commentText: string): number {
  const fallbackNumber = commentText.match(/\d+/);
  return (
    parsePriceFromComment(commentText) ??
    (fallbackNumber && Number(fallbackNumber[0]) <= 100_000 ? Number(fallbackNumber[0]) * 1000 : 20000)
  );
}

export function toMoney(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

export function reconcileOrderAmounts(order: {
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
  const totalAmount = Math.max(0, subtotalAmount + shippingFee - discountAmount);
  const remainingAmount = Math.max(0, totalAmount - depositAmount);
  const codAmount = remainingAmount;
  return { subtotalAmount, shippingFee, discountAmount, depositAmount, codAmount, totalAmount, remainingAmount };
}

export async function updateOrderAmounts(orderId: string, shopId: string, client: DbOrTx = db) {
  const [order] = await client.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.shopId, shopId))).limit(1);
  if (!order) throw notFound("Không tìm thấy đơn hàng.");
  // START: Tính lại subtotalAmount từ orderItems thực tế, không dùng giá trị snapshot cũ trên orders
  const items = await client.select().from(orderItems).where(eq(orderItems.orderId, orderId));
  const subtotalAmount = items.reduce((sum, item) => sum + toMoney(item.price) * toMoney(item.quantity), 0);
  const amounts = reconcileOrderAmounts({ ...order, subtotalAmount });
  // END: subtotalAmount từ items
  await client.update(orders).set({ ...amounts, updatedAt: new Date() }).where(and(eq(orders.id, orderId), eq(orders.shopId, shopId)));
}

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

export async function attachProducts<T extends { id: string; customerAddressId?: string | null; customerId?: string | null }>(orderRows: T[]): Promise<(T & { products: (typeof orderItems.$inferSelect)[]; shipment: (typeof orderShipments.$inferSelect & { spxEditCount?: number; spxEditLimit?: number; spxEditRemaining?: number }) | null; customerAddressData: typeof customerAddresses.$inferSelect | null; customerType: string | null })[]> {
  if (!orderRows.length) return orderRows.map((o) => ({ ...o, products: [], shipment: null, customerAddressData: null, customerType: null }));

  const orderIds = orderRows.map((o) => o.id);
  const addressIds = [...new Set(orderRows.map((o) => o.customerAddressId).filter(Boolean) as string[])];
  const customerIds = [...new Set(orderRows.map((o) => o.customerId).filter(Boolean) as string[])];

  const [items, shipmentRows, editCountRows, addressRows, customerRows] = await Promise.all([
    db.select().from(orderItems).where(inArray(orderItems.orderId, orderIds)),
    db.select().from(orderShipments).where(inArray(orderShipments.orderId, orderIds)),
    db
      .select({ shipmentId: shipmentEvents.shipmentId, count: sql<number>`count(*)::int` })
      .from(shipmentEvents)
      .where(and(inArray(shipmentEvents.orderId, orderIds), eq(shipmentEvents.eventType, SPX_EDIT_EVENT_TYPE)))
      .groupBy(shipmentEvents.shipmentId),
    addressIds.length
      ? db.select().from(customerAddresses).where(inArray(customerAddresses.id, addressIds))
      : Promise.resolve([]),
    customerIds.length
      ? db.select({ id: customers.id, customerType: customers.customerType }).from(customers).where(inArray(customers.id, customerIds))
      : Promise.resolve([]),
  ]);

  const byOrderId = new Map<string, (typeof orderItems.$inferSelect)[]>();
  for (const item of items) {
    const list = byOrderId.get(item.orderId) ?? [];
    list.push(item);
    byOrderId.set(item.orderId, list);
  }

  const editCountByShipmentId = new Map<string, number>();
  for (const row of editCountRows) {
    editCountByShipmentId.set(row.shipmentId, row.count);
  }

  const shipmentByOrderId = new Map<string, typeof orderShipments.$inferSelect & { spxEditCount?: number; spxEditLimit?: number; spxEditRemaining?: number }>();
  for (const s of shipmentRows) {
    const editCount = editCountByShipmentId.get(s.id) ?? 0;
    shipmentByOrderId.set(s.orderId, {
      ...s,
      spxEditCount: editCount,
      spxEditLimit: SPX_EDIT_LIMIT,
      spxEditRemaining: Math.max(0, SPX_EDIT_LIMIT - editCount),
    });
  }

  const addressById = new Map<string, typeof customerAddresses.$inferSelect>();
  for (const a of addressRows) {
    addressById.set(a.id, a);
  }

  const customerTypeById = new Map<string, string | null>();
  for (const c of customerRows) {
    customerTypeById.set(c.id, c.customerType ?? null);
  }

  return orderRows.map((o) => ({
    ...o,
    products: byOrderId.get(o.id) ?? [],
    shipment: shipmentByOrderId.get(o.id) ?? null,
    customerAddressData: o.customerAddressId ? (addressById.get(o.customerAddressId) ?? null) : null,
    customerType: o.customerId ? (customerTypeById.get(o.customerId) ?? null) : null,
  }));
}

export async function assertOrderInShop(orderId: string, shopId: string) {
  const rows = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.shopId, shopId)))
    .limit(1);

  const row = rows[0];
  if (!row) throw notFound("Không tìm thấy đơn hàng.");
  return row;
}

export async function getOrderById(orderId: string, shopId: string) {
  const rows = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.shopId, shopId)))
    .limit(1);
  if (!rows[0]) throw notFound("Không tìm thấy đơn hàng.");
  const [result] = await attachProducts(rows);
  return result;
}

export async function listOrders(shopId: string, shippingStatus?: string, status?: string, limit = 100, offset = 0) {
  const condition = and(
    eq(orders.shopId, shopId),
    shippingStatus ? eq(orders.shippingStatus, shippingStatus) : undefined,
    status ? eq(orders.status, status) : undefined,
  );

  const rows = await db
    .select()
    .from(orders)
    .where(condition)
    .orderBy(sql`${orders.createdAt} desc`)
    .limit(limit)
    .offset(offset);

  return attachProducts(rows);
}

export async function listOrdersLight(shopId: string, shippingStatus?: string, status?: string | string[], limit = 100, offset = 0) {
  const conditions = [eq(orders.shopId, shopId)];

  if (shippingStatus) {
    const statuses = shippingStatus.split(",").map(s => s.trim()).filter(Boolean);
    if (statuses.length === 1) {
      conditions.push(eq(orders.shippingStatus, statuses[0]));
    } else if (statuses.length > 1) {
      conditions.push(inArray(orders.shippingStatus, statuses));
    }
  }

  if (status) {
    const statuses = (Array.isArray(status) ? status : status.split(",")).map((s) => s.trim()).filter(Boolean);
    if (statuses.length === 1) {
      conditions.push(eq(orders.status, statuses[0]));
    } else if (statuses.length > 1) {
      conditions.push(inArray(orders.status, statuses));
    }
  }

  return db
    .select({
      id: orders.id,
      orderCode: orders.orderCode,
      status: orders.status,
      shippingStatus: orders.shippingStatus,
      depositStatus: orders.depositStatus,
      paymentStatus: orders.paymentStatus,
      totalAmount: orders.totalAmount,
      codAmount: orders.codAmount,
      customerName: orders.customerName,
      customerTiktokUsername: orders.customerTiktokUsername,
      customerAvatarUrl: orders.customerAvatarUrl,
      color: orders.color,
      note: orders.note,
      providerCode: orders.providerCode,
      liveSessionId: orders.liveSessionId,
      customerId: orders.customerId,
      // ponytail: cần cho fallback hiển thị "tên sản phẩm" ở Mobile khi order không match preset
      // nào (OrderItem/normalizeApiOrderForUi fallback về commentText) — thiếu cột này Mobile chỉ
      // còn cách hiện literal "Sản phẩm" (không có gì để fallback).
      commentText: orders.commentText,
      createdAt: orders.createdAt,
      updatedAt: orders.updatedAt,
    })
    .from(orders)
    .where(and(...conditions))
    .orderBy(sql`${orders.createdAt} desc`)
    .limit(limit)
    .offset(offset);
}

export async function listShippingOrdersWithShipment(shopId: string, limit = 100, offset = 0) {
  const rows = await db
    .select({
      id: orders.id,
      orderCode: orders.orderCode,
      status: orders.status,
      shippingStatus: orders.shippingStatus,
      depositStatus: orders.depositStatus,
      paymentStatus: orders.paymentStatus,
      subtotalAmount: orders.subtotalAmount,
      shippingFee: orders.shippingFee,
      discountAmount: orders.discountAmount,
      depositAmount: orders.depositAmount,
      totalAmount: orders.totalAmount,
      codAmount: orders.codAmount,
      customerName: orders.customerName,
      customerPhone: orders.customerPhone,
      customerTiktokUsername: orders.customerTiktokUsername,
      customerAvatarUrl: orders.customerAvatarUrl,
      customerAddressId: orders.customerAddressId,
      customerId: orders.customerId,
      color: orders.color,
      note: orders.note,
      providerCode: orders.providerCode,
      createdAt: orders.createdAt,
      updatedAt: orders.updatedAt,
    })
    .from(orders)
    .where(and(eq(orders.shopId, shopId), inArray(orders.status, ["confirmed", "success"])))
    .orderBy(sql`${orders.createdAt} desc`)
    .limit(limit)
    .offset(offset);

  if (!rows.length) return rows.map((o) => ({ ...o, products: [], shipment: null, customerAddressData: null, customerType: null }));

  const orderIds = rows.map((o) => o.id);
  const addressIds = [...new Set(rows.map((o) => o.customerAddressId).filter(Boolean) as string[])];
  const customerIds = [...new Set(rows.map((o) => o.customerId).filter(Boolean) as string[])];

  const [items, shipmentRows, editCountRows, addressRows, customerRows] = await Promise.all([
    db.select().from(orderItems).where(inArray(orderItems.orderId, orderIds)),
    db
      .select({
        id: orderShipments.id,
        orderId: orderShipments.orderId,
        trackingCode: orderShipments.trackingCode,
        trackingLink: orderShipments.trackingLink,
        spxTrackingNo: orderShipments.spxTrackingNo,
      })
      .from(orderShipments)
      .where(inArray(orderShipments.orderId, orderIds)),
    db
      .select({ shipmentId: shipmentEvents.shipmentId, count: sql<number>`count(*)::int` })
      .from(shipmentEvents)
      .where(and(inArray(shipmentEvents.orderId, orderIds), eq(shipmentEvents.eventType, SPX_EDIT_EVENT_TYPE)))
      .groupBy(shipmentEvents.shipmentId),
    addressIds.length
      ? db
          .select({
            id: customerAddresses.id,
            name: customerAddresses.name,
            address: customerAddresses.address,
            province: customerAddresses.province,
            district: customerAddresses.district,
            ward: customerAddresses.ward,
          })
          .from(customerAddresses)
          .where(inArray(customerAddresses.id, addressIds))
      : Promise.resolve([]),
    customerIds.length
      ? db.select({ id: customers.id, customerType: customers.customerType }).from(customers).where(inArray(customers.id, customerIds))
      : Promise.resolve([]),
  ]);

  const byOrderId = new Map<string, (typeof orderItems.$inferSelect)[]>();
  for (const item of items) {
    const list = byOrderId.get(item.orderId) ?? [];
    list.push(item);
    byOrderId.set(item.orderId, list);
  }

  const editCountByShipmentId = new Map<string, number>();
  for (const row of editCountRows) {
    editCountByShipmentId.set(row.shipmentId, row.count);
  }

  const shipmentByOrderId = new Map<string, typeof shipmentRows[number] & { spxEditCount: number; spxEditLimit: number; spxEditRemaining: number }>();
  for (const s of shipmentRows) {
    const editCount = editCountByShipmentId.get(s.id) ?? 0;
    shipmentByOrderId.set(s.orderId, {
      ...s,
      spxEditCount: editCount,
      spxEditLimit: SPX_EDIT_LIMIT,
      spxEditRemaining: Math.max(0, SPX_EDIT_LIMIT - editCount),
    });
  }

  const addressById = new Map<string, { id: string; name: string | null; address: string | null; province: string | null; district: string | null; ward: string | null }>();
  for (const a of addressRows) {
    addressById.set(a.id, a);
  }

  const customerTypeById = new Map<string, string | null>();
  for (const c of customerRows) {
    customerTypeById.set(c.id, c.customerType ?? null);
  }

  return rows.map((o) => ({
    ...o,
    products: byOrderId.get(o.id) ?? [],
    shipment: shipmentByOrderId.get(o.id) ?? null,
    customerAddressData: o.customerAddressId ? (addressById.get(o.customerAddressId) ?? null) : null,
    customerType: o.customerId ? (customerTypeById.get(o.customerId) ?? null) : null,
  }));
}

export async function createOrderFromComment({
  shopId,
  userId,
  comment,
  liveSessionId,
  customerAddressId,
  quantity,
  note = "",
  productCode,
  color,
  size,
}: {
  shopId: string;
  userId: string;
  comment: Record<string, unknown>;
  liveSessionId?: string | null;
  customerAddressId?: string | null;
  quantity?: number;
  note?: string;
  // ponytail: explicit override từ sheet xác nhận (rule/AI) — seller đã chọn lại trong catalog thật.
  // Có productCode → dùng preset đó thẳng, KHÔNG tự suy luận lại từ text để tránh lệch với cái seller vừa xác nhận.
  productCode?: string | null;
  color?: string | null;
  size?: string | null;
}) {
  await assertOrderLimitNotExceeded(shopId);

  const commentText = getCommentText(comment);
  const customerTiktokUsername = getCommentTikTokUsername(comment);
  const displayName = getCommentDisplayName(comment);
  const avatarUrl = getCommentAvatar(comment);

  if (!commentText) throw badRequest("Comment không có nội dung để tạo đơn.");

  const normalizedProductCode = productCode?.trim();
  let preset = normalizedProductCode
    ? await getProductPresetByCode(shopId, normalizedProductCode)
    : await matchPresetByComment(shopId, commentText);
  // ponytail: seller đã chọn 1 mã cụ thể trong sheet — mã không có thật trong catalog là lỗi, không âm thầm
  // rơi về matchPresetByComment (dễ tạo đơn với sản phẩm khác cái seller vừa xác nhận).
  if (normalizedProductCode && !preset) throw badRequest("Sản phẩm không hợp lệ, vui lòng chọn lại.");

  const overrideColor = color?.trim();
  const overrideSize = size?.trim();

  // ponytail: no preset match → price from comment (parser, else first number ×1000, else 20000)
  const safePrice = preset ? preset.price : resolveFallbackCommentPrice(commentText);
  const rawQuantity = Number(quantity);
  const normalizedQuantity = Number.isFinite(rawQuantity) && rawQuantity > 0
    ? Math.max(1, Math.min(9999, Math.floor(rawQuantity)))
    : parseQuantityFromComment(commentText);

  const customer = await findOrCreateCustomer({ shopId, tiktokUsername: customerTiktokUsername, displayName, avatarUrl });

  const normalizedCustomerAddressId = customerAddressId || null;

  const defaultAddress = customer?.id
    ? await db
        .select({ id: customerAddresses.id })
        .from(customerAddresses)
        .where(and(eq(customerAddresses.customerId, customer.id), eq(customerAddresses.isDefault, true)))
        .limit(1)
        .then((rows) => rows[0] ?? null)
    : null;

  const subtotalAmount = safePrice * normalizedQuantity;
  const amounts = reconcileOrderAmounts({ subtotalAmount, shippingFee: 0, discountAmount: 0, depositAmount: 0, codAmount: 0 });
  const liveCommentId = await findDbLiveCommentId({ shopId, liveSessionId, comment });

  if (liveCommentId) {
    const [existingComment] = await db
      .select({ isOrderCreated: liveComments.isOrderCreated })
      .from(liveComments)
      .where(eq(liveComments.id, liveCommentId))
      .limit(1);
    if (existingComment?.isOrderCreated) throw badRequest("Comment này đã được tạo đơn.");
  }

  // ponytail: KHÔNG tự động ghép đơn ở đây nữa — mỗi lần "Tạo đơn" từ comment luôn tạo order riêng.
  // Gộp đơn nháp của cùng khách giờ chỉ thực hiện thủ công qua flow "Gộp đơn" trong customer detail
  // (xem mergeDraftOrders() + POST /api/orders/merge-drafts).

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
      customerAddressId: normalizedCustomerAddressId ?? defaultAddress?.id ?? null,
      commentText,
      color: overrideColor ?? preset?.color ?? null,
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
    productName: preset?.name || preset?.code || commentText,
    variantName: "",
    color: overrideColor ?? preset?.color ?? "",
    size: overrideSize ?? "",
    quantity: normalizedQuantity,
    price: safePrice,
    rawCommentText: commentText,
  });

  void Promise.all([
    updateLiveCommentOrder({ commentId: liveCommentId, orderId: order.id, customerId: customer?.id ?? null }),
    updateLiveSessionOrderCount(liveSessionId ?? null),
    updateCustomerAfterOrder({ customerId: customer?.id ?? null, totalAmount: amounts.totalAmount }),
  ]).catch((err) => {
    logger.error({ err }, "CREATE_ORDER_FROM_COMMENT_SIDE_EFFECT_FAILED");
  });

  return {
    success: true,
    message: "Tạo đơn thành công.",
    orderId: order.id,
    orderCode: order.orderCode,
    presetMatched: preset
      ? { code: preset.code, name: preset.name, color: preset.color, price: preset.price }
      : null,
  };
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
  const current = await assertOrderInShop(orderId, shopId);

  // ponytail: explicit allowlist prevents illegal jumps (e.g. draft → completed)
  const ALLOWED: Record<string, string[]> = {
    draft: ["confirmed", "canceled"],
    confirmed: ["packed", "canceled"],
    packed: ["shipping", "canceled"],
    shipping: ["completed", "returned"],
    completed: [],
    canceled: [],
    returned: [],
  };

  const allowed = ALLOWED[current.status ?? "draft"] ?? [];
  if (!allowed.includes(status)) {
    throw badRequest(`Không thể chuyển trạng thái từ "${current.status}" sang "${status}".`);
  }

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

  const [items, addressRows] = await Promise.all([
    db.select().from(orderItems).where(eq(orderItems.orderId, orderId)),
    updated.customerAddressId
      ? db.select().from(customerAddresses).where(eq(customerAddresses.id, updated.customerAddressId)).limit(1)
      : Promise.resolve([]),
  ]);
  return { ...updated, products: items, customerAddressData: addressRows[0] ?? null };
}

export type StatChartPoint = { date: string; value: number };
export type StatSection = { total: number; avg: number; max: number; chart: StatChartPoint[] };
export type OrderStatsResult = {
  revenue: StatSection;
  orders: StatSection;
  products: StatSection;
  customers: StatSection;
  prev: { revenue: number; orders: number; products: number; customers: number };
};

export async function getOrderStats({
  shopId,
  dateFrom,
  dateTo,
  depositStatus,
  status,
}: {
  shopId: string;
  dateFrom: Date;
  dateTo: Date;
  depositStatus?: string;
  status?: string;
}): Promise<OrderStatsResult> {
  const periodMs = dateTo.getTime() - dateFrom.getTime();
  const prevFrom = new Date(dateFrom.getTime() - periodMs);
  const prevTo = dateFrom;

  const orderWhere = (from: Date, to: Date) =>
    and(
      eq(orders.shopId, shopId),
      gte(orders.createdAt, from),
      lt(orders.createdAt, to),
      depositStatus ? eq(orders.depositStatus, depositStatus) : undefined,
      status ? eq(orders.status, status) : undefined,
    );

  const [revenueRows, productRows, customerRows, prevRevRow, prevProdRow, prevCustRow] =
    await Promise.all([
      db
        .select({
          date: sql<string>`date_trunc('day', ${orders.createdAt})::date::text`,
          revenue: sql<number>`coalesce(sum(${orders.totalAmount}), 0)::int`,
          orderCount: sql<number>`count(*)::int`,
        })
        .from(orders)
        .where(orderWhere(dateFrom, dateTo))
        .groupBy(sql`date_trunc('day', ${orders.createdAt})`)
        .orderBy(sql`date_trunc('day', ${orders.createdAt})`),

      db
        .select({
          date: sql<string>`date_trunc('day', ${orders.createdAt})::date::text`,
          products: sql<number>`coalesce(sum(${orderItems.quantity}), 0)::int`,
        })
        .from(orders)
        .innerJoin(orderItems, eq(orderItems.orderId, orders.id))
        .where(orderWhere(dateFrom, dateTo))
        .groupBy(sql`date_trunc('day', ${orders.createdAt})`)
        .orderBy(sql`date_trunc('day', ${orders.createdAt})`),

      db
        .select({
          date: sql<string>`date_trunc('day', ${customers.createdAt})::date::text`,
          count: sql<number>`count(*)::int`,
        })
        .from(customers)
        .where(and(eq(customers.shopId, shopId), gte(customers.createdAt, dateFrom), lt(customers.createdAt, dateTo)))
        .groupBy(sql`date_trunc('day', ${customers.createdAt})`)
        .orderBy(sql`date_trunc('day', ${customers.createdAt})`),

      db
        .select({
          revenue: sql<number>`coalesce(sum(${orders.totalAmount}), 0)::int`,
          orderCount: sql<number>`count(*)::int`,
        })
        .from(orders)
        .where(orderWhere(prevFrom, prevTo)),

      db
        .select({ products: sql<number>`coalesce(sum(${orderItems.quantity}), 0)::int` })
        .from(orders)
        .innerJoin(orderItems, eq(orderItems.orderId, orders.id))
        .where(orderWhere(prevFrom, prevTo)),

      db
        .select({ count: sql<number>`count(*)::int` })
        .from(customers)
        .where(and(eq(customers.shopId, shopId), gte(customers.createdAt, prevFrom), lt(customers.createdAt, prevTo))),
    ]);

  function toSection(chart: StatChartPoint[]): StatSection {
    const total = chart.reduce((s, r) => s + r.value, 0);
    const avg = chart.length ? Math.round(total / chart.length) : 0;
    const max = chart.length ? Math.max(...chart.map((r) => r.value)) : 0;
    return { total, avg, max, chart };
  }

  return {
    revenue: toSection(revenueRows.map((r) => ({ date: r.date, value: r.revenue }))),
    orders: toSection(revenueRows.map((r) => ({ date: r.date, value: r.orderCount }))),
    products: toSection(productRows.map((r) => ({ date: r.date, value: r.products }))),
    customers: toSection(customerRows.map((r) => ({ date: r.date, value: r.count }))),
    prev: {
      revenue: prevRevRow[0]?.revenue ?? 0,
      orders: prevRevRow[0]?.orderCount ?? 0,
      products: prevProdRow[0]?.products ?? 0,
      customers: prevCustRow[0]?.count ?? 0,
    },
  };
}

export async function mergeDraftOrders({
  shopId,
  targetOrderId,
  sourceOrderIds,
}: {
  shopId: string;
  targetOrderId: string;
  sourceOrderIds: string[];
}) {
  const uniqueSourceOrderIds = [...new Set(sourceOrderIds)].filter((id) => id !== targetOrderId);
  if (uniqueSourceOrderIds.length === 0) throw badRequest("Cần ít nhất 1 đơn nguồn để ghép.");

  const selectedOrderIds = [targetOrderId, ...uniqueSourceOrderIds];

  const result = await db.transaction(async (tx) => {
    const selectedOrders = await tx
      .select({ id: orders.id, customerId: orders.customerId, status: orders.status })
      .from(orders)
      .where(and(eq(orders.shopId, shopId), inArray(orders.id, selectedOrderIds)));

    if (selectedOrders.length !== selectedOrderIds.length) throw notFound("Không tìm thấy đủ đơn hàng cần ghép.");

    const targetOrder = selectedOrders.find((order) => order.id === targetOrderId);
    if (!targetOrder) throw notFound("Không tìm thấy đơn đích.");
    if (!targetOrder.customerId) throw badRequest("Đơn đích chưa có khách hàng.");

    const invalidOrder = selectedOrders.find(
      (order) => order.status !== "draft" || order.customerId !== targetOrder.customerId,
    );
    if (invalidOrder) throw badRequest("Chỉ được ghép các đơn draft cùng customer.");

    const selectedShipments = await tx
      .select({ id: orderShipments.id })
      .from(orderShipments)
      .where(inArray(orderShipments.orderId, selectedOrderIds))
      .limit(1);
    if (selectedShipments.length > 0) throw badRequest("Không được ghép đơn đã có vận đơn.");

    const movedItems = await tx
      .update(orderItems)
      .set({ orderId: targetOrderId, updatedAt: new Date() })
      .where(inArray(orderItems.orderId, uniqueSourceOrderIds))
      .returning({ id: orderItems.id });

    await tx
      .update(liveComments)
      .set({ orderId: targetOrderId, customerId: targetOrder.customerId, isOrderCreated: true, updatedAt: new Date() })
      .where(inArray(liveComments.orderId, uniqueSourceOrderIds));

    await tx.delete(orders).where(and(eq(orders.shopId, shopId), inArray(orders.id, uniqueSourceOrderIds)));
    await updateOrderAmounts(targetOrderId, shopId, tx);
    // ponytail: merge keeps the same customer spend, only reduces visible order count.
    await tx
      .update(customers)
      .set({
        totalOrders: sql`greatest(coalesce(${customers.totalOrders}, 0) - ${uniqueSourceOrderIds.length}, 1)`,
        updatedAt: new Date(),
      })
      .where(and(eq(customers.id, targetOrder.customerId), eq(customers.shopId, shopId)));

    return {
      customerId: targetOrder.customerId,
      mergedOrderIds: selectedOrderIds,
      deletedOrderIds: uniqueSourceOrderIds,
      mergedItemCount: movedItems.length,
    };
  });

  const [order, refreshedOrders] = await Promise.all([
    getOrderById(targetOrderId, shopId),
    listCustomerOrders(shopId, result.customerId),
  ]);
  return { ...result, targetOrderId, order, orders: refreshedOrders };
}

export async function deleteOrder({ shopId, orderId }: { shopId: string; orderId: string }) {
  const order = await assertOrderInShop(orderId, shopId);
  await db.delete(orders).where(and(eq(orders.id, orderId), eq(orders.shopId, shopId)));
  await decrementCustomerAfterOrderDelete({
    customerId: order.customerId,
    totalAmount: order.totalAmount ?? 0,
  });
  return { ok: true };
}
