import { eq, and } from "drizzle-orm";
import { db } from "../lib/db.js";
import { shopAddresses } from "../db/schema/index.js";
import { notFound } from "../lib/api-error.js";

export async function listShopAddresses(shopId: string) {
  return db
    .select()
    .from(shopAddresses)
    .where(eq(shopAddresses.shopId, shopId))
    .orderBy(shopAddresses.isDefault, shopAddresses.createdAt);
}

export async function createShopAddress(
  shopId: string,
  data: { label?: string | null; name?: string | null; phone?: string | null; address?: string | null; province?: string | null; district?: string | null; ward?: string | null; isDefault?: boolean },
) {
  if (data.isDefault) {
    await db.update(shopAddresses).set({ isDefault: false }).where(eq(shopAddresses.shopId, shopId));
  }

  const [row] = await db.insert(shopAddresses).values({ shopId, ...data }).returning();
  return row;
}

export async function updateShopAddress(
  shopId: string,
  addressId: string,
  data: { label?: string | null; name?: string | null; phone?: string | null; address?: string | null; province?: string | null; district?: string | null; ward?: string | null; isDefault?: boolean },
) {
  const existing = await db
    .select()
    .from(shopAddresses)
    .where(and(eq(shopAddresses.id, addressId), eq(shopAddresses.shopId, shopId)))
    .limit(1);

  if (!existing.length) throw notFound("Địa chỉ không tồn tại.");

  if (data.isDefault) {
    await db.update(shopAddresses).set({ isDefault: false }).where(eq(shopAddresses.shopId, shopId));
  }

  const [row] = await db
    .update(shopAddresses)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(shopAddresses.id, addressId))
    .returning();
  return row;
}

export async function deleteShopAddress(shopId: string, addressId: string) {
  const existing = await db
    .select()
    .from(shopAddresses)
    .where(and(eq(shopAddresses.id, addressId), eq(shopAddresses.shopId, shopId)))
    .limit(1);

  if (!existing.length) throw notFound("Địa chỉ không tồn tại.");

  await db.delete(shopAddresses).where(eq(shopAddresses.id, addressId));
}
