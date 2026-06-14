import { eq, and } from "drizzle-orm";
import { db } from "../lib/db.js";
import { customerAddresses } from "../db/schema/index.js";
import { notFound } from "../lib/api-error.js";

export async function listCustomerAddresses(shopId: string, customerId: string) {
  return db
    .select()
    .from(customerAddresses)
    .where(and(eq(customerAddresses.shopId, shopId), eq(customerAddresses.customerId, customerId)))
    .orderBy(customerAddresses.isDefault, customerAddresses.createdAt);
}

export async function createCustomerAddress(
  shopId: string,
  customerId: string,
  data: { label?: string | null; name?: string | null; phone?: string | null; address?: string | null; province?: string | null; district?: string | null; ward?: string | null; isDefault?: boolean },
) {
  if (data.isDefault) {
    await db
      .update(customerAddresses)
      .set({ isDefault: false })
      .where(and(eq(customerAddresses.shopId, shopId), eq(customerAddresses.customerId, customerId)));
  }

  const [row] = await db
    .insert(customerAddresses)
    .values({ shopId, customerId, ...data })
    .returning();
  return row;
}

export async function updateCustomerAddress(
  shopId: string,
  customerId: string,
  addressId: string,
  data: { label?: string | null; name?: string | null; phone?: string | null; address?: string | null; province?: string | null; district?: string | null; ward?: string | null; isDefault?: boolean },
) {
  const existing = await db
    .select()
    .from(customerAddresses)
    .where(
      and(
        eq(customerAddresses.id, addressId),
        eq(customerAddresses.customerId, customerId),
        eq(customerAddresses.shopId, shopId),
      ),
    )
    .limit(1);

  if (!existing.length) throw notFound("Địa chỉ không tồn tại.");

  if (data.isDefault) {
    await db
      .update(customerAddresses)
      .set({ isDefault: false })
      .where(and(eq(customerAddresses.shopId, shopId), eq(customerAddresses.customerId, customerId)));
  }

  const [row] = await db
    .update(customerAddresses)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(customerAddresses.id, addressId))
    .returning();
  return row;
}

export async function deleteCustomerAddress(shopId: string, customerId: string, addressId: string) {
  const existing = await db
    .select()
    .from(customerAddresses)
    .where(
      and(
        eq(customerAddresses.id, addressId),
        eq(customerAddresses.customerId, customerId),
        eq(customerAddresses.shopId, shopId),
      ),
    )
    .limit(1);

  if (!existing.length) throw notFound("Địa chỉ không tồn tại.");

  await db.delete(customerAddresses).where(eq(customerAddresses.id, addressId));
}
