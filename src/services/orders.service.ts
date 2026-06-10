import { eq, and, inArray, sql } from "drizzle-orm";
import { db } from "../lib/db.js";
import { orders, orderItems } from "../db/schema/index.js";
import { badRequest, notFound } from "../lib/api-error.js";
import { getCommentAvatar, getCommentDisplayName, getCommentText } from "../utils/comment.js";
import { createOrderCode, isUuid } from "../utils/id.js";
import { getCommentTikTokUsername } from "../utils/tiktok.js";
import { findOrCreateCustomer, updateCustomerAfterOrder } from "./customer.service.js";
import { findDbLiveCommentId, updateLiveCommentOrder } from "./live-comments.service.js";
import { updateLiveSessionOrderCount } from "./live-sessions.service.js";

const DEFAULT_PRICE = 20;
const DEFAULT_QUANTITY = 1;

async function attachProducts<T extends { id: string }>(orderRows: T[]): Promise<(T & { products: any[] })[]> {
  if (!orderRows.length) return orderRows.map((o) => ({ ...o, products: [] }));

  const orderIds = orderRows.map((o) => o.id);
  const items = await db.select().from(orderItems).where(inArray(orderItems.orderId, orderIds));

  const byOrderId = new Map<string, any[]>();
  for (const item of items) {
    const list = byOrderId.get(item.orderId) ?? [];
    list.push(item);
    byOrderId.set(item.orderId, list);
  }

  return orderRows.map((o) => ({ ...o, products: byOrderId.get(o.id) ?? [] }));
}

export async function listOrders(shopId: string) {
  const rows = await db
    .select()
    .from(orders)
    .where(eq(orders.shopId, shopId))
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
  const commentText = getCommentText(comment);
  const customerTikTokUsername = getCommentTikTokUsername(comment);
  const displayName = getCommentDisplayName(comment);
  const avatarUrl = getCommentAvatar(comment);

  if (!commentText) throw badRequest("Comment không có nội dung để tạo đơn.");

  const safePrice = Number.isFinite(Number(price)) ? Number(price) : DEFAULT_PRICE;
  const safeQuantity = Number.isFinite(Number(quantity)) ? Number(quantity) : DEFAULT_QUANTITY;

  const customer = await findOrCreateCustomer({ shopId, tiktokUsername: customerTikTokUsername, displayName, avatarUrl });

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
      orderCode: createOrderCode(),
      source: "live_comment",
      customerName: displayName,
      customerTiktokUsername: customerTikTokUsername,
      customerPhone: "",
      customerAddress: "",
      commentText,
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
    productCode: "",
    productName: commentText,
    variantName: "",
    color: "",
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
    depositStatus === "paid" ? "paid" : depositStatus === "deposited" ? "partial" : "unpaid";

  const [updated] = await db
    .update(orders)
    .set({ depositStatus, paymentStatus, updatedAt: new Date() })
    .where(and(eq(orders.id, orderId), eq(orders.shopId, shopId)))
    .returning();

  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
  return { ...updated, products: items };
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

  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
  return { ...updated, products: items };
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
