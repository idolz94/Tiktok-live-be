import { eq, and } from "drizzle-orm";
import { db } from "../lib/db.js";
import { shopProductPresets } from "../db/schema/index.js";
import { notFound } from "../lib/api-error.js";

export type ProductPreset = {
  id: string;
  shopId: string;
  code: string;
  name: string | null;
  color: string | null;
  price: number;
  sortOrder: number;
  createdAt: Date | null;
  updatedAt: Date | null;
};

export async function listProductPresets(shopId: string): Promise<ProductPreset[]> {
  return db
    .select()
    .from(shopProductPresets)
    .where(eq(shopProductPresets.shopId, shopId))
    .orderBy(shopProductPresets.sortOrder, shopProductPresets.createdAt);
}

export async function createProductPreset(
  shopId: string,
  data: { code: string; name?: string | null; color?: string | null; price: number },
): Promise<ProductPreset> {
  const existing = await db
    .select({ sortOrder: shopProductPresets.sortOrder })
    .from(shopProductPresets)
    .where(eq(shopProductPresets.shopId, shopId))
    .orderBy(shopProductPresets.sortOrder)
    .limit(1000);

  const maxSort = existing.reduce((m, r) => Math.max(m, r.sortOrder ?? 0), 0);

  const [row] = await db
    .insert(shopProductPresets)
    .values({
      shopId,
      code: data.code.trim(),
      name: data.name?.trim() || null,
      color: data.color?.trim() || null,
      price: Math.max(0, Math.round(data.price)),
      sortOrder: maxSort + 1,
    })
    .returning();

  return row;
}

export async function updateProductPreset(
  shopId: string,
  presetId: string,
  data: { code?: string; name?: string | null; color?: string | null; price?: number },
): Promise<ProductPreset> {
  const existing = await db
    .select()
    .from(shopProductPresets)
    .where(and(eq(shopProductPresets.id, presetId), eq(shopProductPresets.shopId, shopId)))
    .limit(1);

  if (!existing[0]) throw notFound("Không tìm thấy preset sản phẩm.");

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (data.code !== undefined) patch.code = data.code.trim();
  if (data.name !== undefined) patch.name = data.name?.trim() || null;
  if (data.color !== undefined) patch.color = data.color?.trim() || null;
  if (data.price !== undefined) patch.price = Math.max(0, Math.round(data.price));

  const [updated] = await db
    .update(shopProductPresets)
    .set(patch)
    .where(and(eq(shopProductPresets.id, presetId), eq(shopProductPresets.shopId, shopId)))
    .returning();

  return updated;
}

export async function deleteProductPreset(shopId: string, presetId: string): Promise<void> {
  const existing = await db
    .select({ id: shopProductPresets.id })
    .from(shopProductPresets)
    .where(and(eq(shopProductPresets.id, presetId), eq(shopProductPresets.shopId, shopId)))
    .limit(1);

  if (!existing[0]) throw notFound("Không tìm thấy preset sản phẩm.");

  await db
    .delete(shopProductPresets)
    .where(and(eq(shopProductPresets.id, presetId), eq(shopProductPresets.shopId, shopId)));
}

function normalizeToken(s: string): string {
  return s.toLowerCase().replace(/\s+/g, "").trim();
}

export async function matchPresetByComment(
  shopId: string,
  commentText: string,
): Promise<ProductPreset | null> {
  const presets = await listProductPresets(shopId);
  console.log(`[matchPreset] shopId=${shopId} comment="${commentText}" presets=${JSON.stringify(presets.map(p => ({ code: p.code, price: p.price })))}`);
  if (!presets.length) return null;

  const text = commentText.toLowerCase().trim();
  const textNoSpace = normalizeToken(commentText);

  for (const preset of presets) {
    const code = preset.code.trim().toLowerCase();
    if (!code) continue;

    // 1. Exact or substring match (with spaces)
    if (text === code || text.includes(code)) return preset;

    // 2. Space-stripped match: "JBL5" matches preset "JBL 5"
    const codeNoSpace = normalizeToken(preset.code);
    if (codeNoSpace && (textNoSpace === codeNoSpace || textNoSpace.includes(codeNoSpace))) return preset;

    // 3. Word-boundary regex (original logic)
    const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`(?:^|\\s|[#%])${escaped}(?:$|\\s|[^a-z0-9])`, "i");
    if (regex.test(text)) return preset;
  }

  return null;
}
