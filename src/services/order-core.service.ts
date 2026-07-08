import { eq, and, inArray, sql, gte, lt } from "drizzle-orm";
import { db } from "../lib/db.js";
import { orders, orderItems, orderShipments, customerAddresses, customers } from "../db/schema/index.js";
import { badRequest, notFound } from "../lib/api-error.js";
import { getCommentAvatar, getCommentDisplayName, getCommentText } from "../utils/comment.js";
import { createOrderCode } from "../utils/id.js";
import { getCommentTikTokUsername } from "../utils/tiktok.js";
import { findOrCreateCustomer, updateCustomerAfterOrder, decrementCustomerAfterOrderDelete } from "./customer.service.js";
import { findDbLiveCommentId, updateLiveCommentOrder } from "./live-comments.service.js";
import { updateLiveSessionOrderCount } from "./live-sessions.service.js";
import { matchPresetByComment } from "./product-presets.service.js";
import { getCurrentLicense } from "./license.service.js";
import logger from "../lib/logger.js";

const DEFAULT_PRICE = 20000;
const DEFAULT_QUANTITY = 1;

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

export async function updateOrderAmounts(orderId: string, shopId: string) {
  const [order] = await db.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.shopId, shopId))).limit(1);
  if (!order) throw notFound("Không tìm thấy đơn hàng.");
  const amounts = reconcileOrderAmounts(order);
  await db.update(orders).set({ ...amounts, updatedAt: new Date() }).where(and(eq(orders.id, orderId), eq(orders.shopId, shopId)));
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

export async function attachProducts<T extends { id: string; customerAddressId?: string | null; customerId?: string | null }>(orderRows: T[]): Promise<(T & { products: (typeof orderItems.$inferSelect)[]; shipment: typeof orderShipments.$inferSelect | null; customerAddressData: typeof customerAddresses.$inferSelect | null; customerType: string | null })[]> {
  if (!orderRows.length) return orderRows.map((o) => ({ ...o, products: [], shipment: null, customerAddressData: null, customerType: null }));

  const orderIds = orderRows.map((o) => o.id);
  const addressIds = [...new Set(orderRows.map((o) => o.customerAddressId).filter(Boolean) as string[])];
  const customerIds = [...new Set(orderRows.map((o) => o.customerId).filter(Boolean) as string[])];

  const [items, shipmentRows, addressRows, customerRows] = await Promise.all([
    db.select().from(orderItems).where(inArray(orderItems.orderId, orderIds)),
    db.select().from(orderShipments).where(inArray(orderShipments.orderId, orderIds)),
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

  const shipmentByOrderId = new Map<string, typeof orderShipments.$inferSelect>();
  for (const s of shipmentRows) {
    shipmentByOrderId.set(s.orderId, s);
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

export async function createOrderFromComment({
  shopId,
  userId,
  comment,
  liveSessionId,
  customerAddressId,
  price = DEFAULT_PRICE,
  quantity = DEFAULT_QUANTITY,
  note = "",
}: {
  shopId: string;
  userId: string;
  comment: Record<string, unknown>;
  liveSessionId?: string | null;
  customerAddressId?: string | null;
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

  const normalizedCustomerAddressId = customerAddressId || null;

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
      customerAddressId: normalizedCustomerAddressId ?? defaultAddress?.id ?? null,
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
    productName: preset?.name || preset?.code || commentText,
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
    logger.error({ err }, "CREATE_ORDER_FROM_COMMENT_SIDE_EFFECT_FAILED");
  });

  return {
    success: true,
    message: "Tạo đơn thành công.",
    orderId: order.id,
    orderCode: order.orderCode,
    presetMatched: preset ? { code: preset.code, name: preset.name, color: preset.color, price: preset.price } : null,
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

  return updated;
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

export async function deleteOrder({ shopId, orderId }: { shopId: string; orderId: string }) {
  const order = await assertOrderInShop(orderId, shopId);
  await db.delete(orders).where(and(eq(orders.id, orderId), eq(orders.shopId, shopId)));
  await decrementCustomerAfterOrderDelete({
    customerId: order.customerId,
    totalAmount: order.totalAmount ?? 0,
  });
  return { ok: true };
}
