import { eq, and } from "drizzle-orm";
import { db } from "../lib/db.js";
import { customers, orders } from "../db/schema/index.js";
import { notFound } from "../lib/api-error.js";

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
