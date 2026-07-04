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
  data: { code?: string | null; name?: string | null; color?: string | null; price?: number },
): Promise<ProductPreset> {
  const existing = await db
    .select()
    .from(shopProductPresets)
    .where(and(eq(shopProductPresets.id, presetId), eq(shopProductPresets.shopId, shopId)))
    .limit(1);

  if (!existing[0]) throw notFound("Không tìm thấy preset sản phẩm.");

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (data.code !== undefined) patch.code = data.code?.trim() ?? "";
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
  return s.normalize("NFC").toLowerCase().replace(/\s+/g, "").trim();
}

export async function matchPresetByComment(
  shopId: string,
  commentText: string,
): Promise<ProductPreset | null> {
  const presets = await listProductPresets(shopId);
  if (!presets.length) return null;

  const text = commentText.normalize("NFC").toLowerCase().trim();
  const textNoSpace = normalizeToken(commentText);

  function matchesKeyword(rawKeyword: string): boolean {
    const keyword = rawKeyword.normalize("NFC");
    if (!keyword) return false;
    if (text === keyword || text.includes(keyword)) return true;
    const kNoSpace = normalizeToken(keyword);
    if (kNoSpace && (textNoSpace === kNoSpace || textNoSpace.includes(kNoSpace))) return true;
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?:^|\\s|[#%])${escaped}(?:$|\\s|[^a-z0-9])`, "i").test(text);
  }

  // Pass 1: name + color both present in comment (highest specificity)
  for (const preset of presets) {
    const name = (preset.name ?? "").trim().toLowerCase();
    const color = (preset.color ?? "").trim().toLowerCase();
    if (name && color && matchesKeyword(name) && matchesKeyword(color)) return preset;
  }

  // Pass 2: name match — skip if comment contains a known color but preset's color doesn't match
  const allKnownColors = new Set(
    presets.map((p) => (p.color ?? "").trim().toLowerCase()).filter(Boolean),
  );
  const commentHasKnownColor = [...allKnownColors].some((c) => matchesKeyword(c));
  for (const preset of presets) {
    const name = (preset.name ?? "").trim().toLowerCase();
    if (!name || !matchesKeyword(name)) continue;
    const color = (preset.color ?? "").trim().toLowerCase();
    if (color && commentHasKnownColor && !matchesKeyword(color)) continue;
    return preset;
  }

  // Pass 3: no name — match by code + color
  for (const preset of presets) {
    const name = (preset.name ?? "").trim();
    const code = preset.code.trim().toLowerCase();
    const color = (preset.color ?? "").trim().toLowerCase();
    if (name) continue;
    if (!code) continue;
    const escapedCode = code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const codeMatch = new RegExp(`(?:^|\\s|[#%])${escapedCode}(?:$|\\s|[^a-z0-9])`, "i").test(text);
    if (codeMatch && color && matchesKeyword(color)) return preset;
  }

  // Pass 4: no name — match by code only
  for (const preset of presets) {
    const name = (preset.name ?? "").trim();
    const code = preset.code.trim().toLowerCase();
    if (name || !code) continue;
    const escapedCode = code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(?:^|\\s|[#%])${escapedCode}(?:$|\\s|[^a-z0-9])`, "i").test(text)) return preset;
  }

  return null;
}
