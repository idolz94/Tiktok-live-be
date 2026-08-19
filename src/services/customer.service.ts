import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "../lib/db.js";
import { customers, orderItems, orders } from "../db/schema/index.js";
import { forbidden, notFound } from "../lib/api-error.js";

export async function findOrCreateCustomer({
  shopId,
  tiktokUsername,
  displayName,
  avatarUrl,
}: {
  shopId: string;
  tiktokUsername: string;
  displayName: string;
  avatarUrl: string;
}) {
  const normalizedUsername = String(tiktokUsername || "").trim();
  if (!normalizedUsername) return null;

  const rows = await db
    .select()
    .from(customers)
    .where(and(eq(customers.shopId, shopId), eq(customers.tiktokUsername, normalizedUsername)))
    .limit(1);

  if (rows[0]) {
    const existing = rows[0];
    const newAvatar = avatarUrl?.trim() || null;
    if (newAvatar && newAvatar !== existing.avatarUrl) {
      const [updated] = await db
        .update(customers)
        .set({ avatarUrl: newAvatar, updatedAt: new Date() })
        .where(eq(customers.id, existing.id))
        .returning();
      return updated ?? existing;
    }
    return existing;
  }

  const [newCustomer] = await db
    .insert(customers)
    .values({
      shopId,
      tiktokUsername: normalizedUsername,
      tiktokUniqueId: normalizedUsername.replace(/^@/, ""),
      displayName,
      avatarUrl,
      customerType: "Lẻ",
      totalOrders: 0,
      totalSpent: 0,
      tags: [],
    })
    .returning();

  return newCustomer;
}

export async function getCustomerById({
  shopId,
  customerId,
}: {
  shopId: string;
  customerId: string;
}) {
  const rows = await db
    .select()
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.shopId, shopId)))
    .limit(1);
  const customer = rows[0];
  if (!customer) throw notFound("Không tìm thấy khách hàng.");
  return customer;
}

export async function updateCustomerAfterOrder({
  customerId,
  totalAmount,
}: {
  customerId?: string | null;
  totalAmount: number;
}) {
  if (!customerId) return;

  const rows = await db
    .select({ id: customers.id, totalOrders: customers.totalOrders, totalSpent: customers.totalSpent })
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);

  const customer = rows[0];
  if (!customer) return;

  await db
    .update(customers)
    .set({
      totalOrders: (customer.totalOrders ?? 0) + 1,
      totalSpent: (customer.totalSpent ?? 0) + totalAmount,
      lastOrderAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(customers.id, customerId));
}

export async function decrementCustomerAfterOrderDelete({
  customerId,
  totalAmount,
}: {
  customerId?: string | null;
  totalAmount: number;
}) {
  if (!customerId) return;

  const rows = await db
    .select({ id: customers.id, totalOrders: customers.totalOrders, totalSpent: customers.totalSpent })
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);

  const customer = rows[0];
  if (!customer) return;

  const newTotalOrders = Math.max(0, (customer.totalOrders ?? 0) - 1);
  const newTotalSpent = Math.max(0, (customer.totalSpent ?? 0) - totalAmount);

  if (newTotalOrders === 0) {
    // null out FK trên orders trước để tránh FK violation khi xóa
    await db
      .update(orders)
      .set({ customerId: null })
      .where(eq(orders.customerId, customerId));
    await db.delete(customers).where(eq(customers.id, customerId));
    return;
  }

  await db
    .update(customers)
    .set({ totalOrders: newTotalOrders, totalSpent: newTotalSpent, updatedAt: new Date() })
    .where(eq(customers.id, customerId));
}

export async function updateCustomerProfile({
  shopId,
  customerId,
  customerType,
  phone,
  referenceInfo,
  shippingAddress,
}: {
  shopId: string;
  customerId: string;
  customerType?: string | null;
  phone?: string | null;
  referenceInfo?: string | null;
  shippingAddress?: string | null;
}) {
  const patch: Record<string, unknown> = { updatedAt: new Date() };

  if (customerType !== undefined) patch.customerType = customerType;
  if (phone !== undefined) patch.phone = phone;
  if (referenceInfo !== undefined) patch.referenceInfo = referenceInfo;
  if (shippingAddress !== undefined) patch.shippingAddress = shippingAddress;

  const rows = await db
    .update(customers)
    .set(patch)
    .where(and(eq(customers.id, customerId), eq(customers.shopId, shopId)))
    .returning();

  const updated = rows[0];
  if (!updated) throw notFound("Không tìm thấy khách hàng.");

  return updated;
}

export async function getCustomerOverview(shopId: string) {
  const [totalRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(customers)
    .where(eq(customers.shopId, shopId));

  const typeRows = await db
    .select({ customerType: customers.customerType, count: sql<number>`count(*)::int` })
    .from(customers)
    .where(eq(customers.shopId, shopId))
    .groupBy(customers.customerType);

  const topSpenders = await db
    .select({
      id: customers.id,
      displayName: customers.displayName,
      tiktokUsername: customers.tiktokUsername,
      avatarUrl: customers.avatarUrl,
      totalOrders: customers.totalOrders,
      totalSpent: customers.totalSpent,
    })
    .from(customers)
    .where(eq(customers.shopId, shopId))
    .orderBy(desc(customers.totalSpent))
    .limit(5);

  const byType: Record<string, number> = {};
  for (const r of typeRows) byType[String(r.customerType ?? "—")] = r.count;

  return {
    totalCustomers: totalRow?.total ?? 0,
    byType,
    topSpenders,
  };
}

export async function listCustomers(shopId: string, limit = 100, offset = 0) {
  return db
    .select({
      id: customers.id,
      tiktokUsername: customers.tiktokUsername,
      displayName: customers.displayName,
      avatarUrl: customers.avatarUrl,
      phone: customers.phone,
      customerType: customers.customerType,
      totalOrders: customers.totalOrders,
      totalSpent: customers.totalSpent,
      lastOrderAt: customers.lastOrderAt,
      createdAt: customers.createdAt,
    })
    .from(customers)
    .where(eq(customers.shopId, shopId))
    .orderBy(customers.createdAt)
    .limit(limit)
    .offset(offset);
}

export async function listCustomerOrders(shopId: string, customerId: string, limit = 200, offset = 0) {
  // Verify customer tồn tại và thuộc đúng shop trước khi query orders
  const customerRows = await db
    .select({ id: customers.id, shopId: customers.shopId })
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);
  const customer = customerRows[0];
  if (!customer) throw notFound("Customer not found");
  if (customer.shopId !== shopId) throw forbidden("Customer does not belong to your shop");

  return db
    .select({
      id: orders.id,
      orderCode: orders.orderCode,
      status: orders.status,
      shippingStatus: orders.shippingStatus,
      totalAmount: orders.totalAmount,
      codAmount: orders.codAmount,
      createdAt: orders.createdAt,
    })
    .from(orders)
    .where(and(eq(orders.shopId, shopId), eq(orders.customerId, customerId), isNull(orders.deletedAt)))
    .orderBy(desc(orders.createdAt))
    .limit(limit)
    .offset(offset);
}

export async function getCustomerAnalytics(shopId: string, customerId: string) {
  const customerRows = await db
    .select({ id: customers.id, shopId: customers.shopId, lastOrderAt: customers.lastOrderAt })
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);
  const customer = customerRows[0];
  if (!customer) throw notFound("Customer not found");
  if (customer.shopId !== shopId) throw forbidden("Customer does not belong to your shop");

  // ponytail: một query đếm + tổng, dùng index orders(shopId,customerId)+where deletedAt IS NULL
  const [agg] = await db
    .select({
      totalOrders: sql<number>`count(*)::int`,
      totalSpent: sql<number>`coalesce(sum(${orders.totalAmount}),0)::int`,
      avgOrderValue: sql<number>`coalesce(avg(${orders.totalAmount}),0)::int`,
      lastOrderAmount: sql<number | null>`(select ${orders.totalAmount} from ${orders} where ${orders.shopId}=${shopId} and ${orders.customerId}=${customerId} and ${orders.deletedAt} is null order by ${orders.createdAt} desc limit 1)`,
    })
    .from(orders)
    .where(and(eq(orders.shopId, shopId), eq(orders.customerId, customerId), isNull(orders.deletedAt)));

  const statusRows = await db
    .select({ status: orders.status, count: sql<number>`count(*)::int` })
    .from(orders)
    .where(and(eq(orders.shopId, shopId), eq(orders.customerId, customerId), isNull(orders.deletedAt)))
    .groupBy(orders.status);

  const topProducts = await db
    .select({
      productCode: orderItems.productCode,
      productName: orderItems.productName,
      qty: sql<number>`sum(${orderItems.quantity})::int`,
    })
    .from(orderItems)
    .innerJoin(orders, and(eq(orderItems.orderId, orders.id), isNull(orders.deletedAt)))
    .where(and(eq(orderItems.shopId, shopId), eq(orders.customerId, customerId)))
    .groupBy(orderItems.productCode, orderItems.productName)
    .orderBy(sql`sum(${orderItems.quantity}) desc`)
    .limit(5);

  const byStatus = Object.fromEntries(statusRows.map((r) => [String(r.status ?? "unknown"), r.count]));

  return {
    totalOrders: agg?.totalOrders ?? 0,
    totalSpent: agg?.totalSpent ?? 0,
    avgOrderValue: agg?.avgOrderValue ?? 0,
    lastOrderAmount: agg?.lastOrderAmount ?? null,
    lastOrderAt: customer.lastOrderAt,
    byStatus,
    topProducts: topProducts.map((p) => ({ productCode: p.productCode, productName: p.productName, quantity: p.qty })),
  };
}
