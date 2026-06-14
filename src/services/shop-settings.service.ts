import { eq, and } from "drizzle-orm";
import { db } from "../lib/db.js";
import { shopSettings } from "../db/schema/index.js";

export type ProductDefaults = {
  code: string;
  color: string;
  size: string;
  price: number;
};

const PRODUCT_DEFAULTS_KEY = "product_defaults";

const defaultProductDefaults: ProductDefaults = {
  code: "",
  color: "",
  size: "",
  price: 0,
};

export async function getProductDefaults(shopId: string): Promise<ProductDefaults> {
  const rows = await db
    .select()
    .from(shopSettings)
    .where(and(eq(shopSettings.shopId, shopId), eq(shopSettings.key, PRODUCT_DEFAULTS_KEY)))
    .limit(1);

  const row = rows[0];
  if (!row?.value) return defaultProductDefaults;

  const val = row.value as Record<string, unknown>;
  return {
    code: typeof val.code === "string" ? val.code : "",
    color: typeof val.color === "string" ? val.color : "",
    size: typeof val.size === "string" ? val.size : "",
    price: typeof val.price === "number" ? val.price : 0,
  };
}

export async function upsertProductDefaults(
  shopId: string,
  payload: Partial<ProductDefaults>,
): Promise<ProductDefaults> {
  const current = await getProductDefaults(shopId);
  const next: ProductDefaults = {
    code: payload.code !== undefined ? payload.code : current.code,
    color: payload.color !== undefined ? payload.color : current.color,
    size: payload.size !== undefined ? payload.size : current.size,
    price: payload.price !== undefined ? payload.price : current.price,
  };

  const existing = await db
    .select({ id: shopSettings.id })
    .from(shopSettings)
    .where(and(eq(shopSettings.shopId, shopId), eq(shopSettings.key, PRODUCT_DEFAULTS_KEY)))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(shopSettings)
      .set({ value: next, updatedAt: new Date() })
      .where(and(eq(shopSettings.shopId, shopId), eq(shopSettings.key, PRODUCT_DEFAULTS_KEY)));
  } else {
    await db.insert(shopSettings).values({
      shopId,
      key: PRODUCT_DEFAULTS_KEY,
      value: next,
    });
  }

  return next;
}
