import { eq, and } from "drizzle-orm";
import { db } from "../lib/db.js";
import { orders, orderItems } from "../db/schema/index.js";
import { notFound } from "../lib/api-error.js";
import { assertOrderInShop, updateOrderAmounts } from "./order-core.service.js";

export async function addOrderItem({
  shopId,
  orderId,
  productCode = "",
  productName = "",
  color = "",
  price,
  quantity,
}: {
  shopId: string;
  orderId: string;
  productCode?: string;
  productName?: string;
  color?: string;
  price: number;
  quantity: number;
}) {
  await assertOrderInShop(orderId, shopId);

  const [item] = await db
    .insert(orderItems)
    .values({ orderId, shopId, productCode, productName, variantName: "", color, size: "", quantity, price, rawCommentText: "" })
    .returning();

  await updateOrderAmounts(orderId, shopId);
  return item;
}

export async function updateOrderItem({
  shopId,
  orderId,
  itemId,
  productCode,
  productName,
  color,
  price,
  quantity,
}: {
  shopId: string;
  orderId: string;
  itemId: string;
  productCode?: string;
  productName?: string;
  color?: string;
  price?: number;
  quantity?: number;
}) {
  await assertOrderInShop(orderId, shopId);

  const existing = await db
    .select()
    .from(orderItems)
    .where(and(eq(orderItems.id, itemId), eq(orderItems.orderId, orderId)))
    .limit(1);

  if (!existing[0]) throw notFound("Không tìm thấy sản phẩm trong đơn hàng.");

  const patch: Record<string, unknown> = {};
  if (productCode !== undefined) patch.productCode = productCode;
  if (productName !== undefined) patch.productName = productName;
  if (color !== undefined) patch.color = color;
  if (price !== undefined) patch.price = price;
  if (quantity !== undefined) patch.quantity = quantity;

  const [updated] = await db
    .update(orderItems)
    .set(patch)
    .where(and(eq(orderItems.id, itemId), eq(orderItems.orderId, orderId)))
    .returning();

  await updateOrderAmounts(orderId, shopId);

  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  return { item: updated, order: order ?? null };
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

  const existing = await db
    .select()
    .from(orderItems)
    .where(and(eq(orderItems.id, itemId), eq(orderItems.orderId, orderId)))
    .limit(1);

  if (!existing[0]) throw notFound("Không tìm thấy sản phẩm trong đơn hàng.");

  await db.delete(orderItems).where(and(eq(orderItems.id, itemId), eq(orderItems.orderId, orderId)));
  await updateOrderAmounts(orderId, shopId);

  return { ok: true };
}
