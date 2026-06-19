import { eq, and } from "drizzle-orm";
import { db } from "../lib/db.js";
import { tiktokChannels, shops } from "../db/schema/index.js";
import { badRequest, notFound } from "../lib/api-error.js";
import { normalizeAtUsername } from "../utils/tiktok.js";

export async function listTikTokChannels(shopId: string) {
  return db
    .select()
    .from(tiktokChannels)
    .where(eq(tiktokChannels.shopId, shopId))
    .orderBy(tiktokChannels.isDefault, tiktokChannels.createdAt);
}

export async function createTikTokChannel({
  shopId,
  tiktokUsername,
  displayName,
  isDefault = false,
}: {
  shopId: string;
  tiktokUsername: string;
  displayName?: string | null;
  isDefault?: boolean;
}) {
  const normalizedUsername = normalizeAtUsername(tiktokUsername);
  if (!normalizedUsername) throw badRequest("Thiếu TikTok username.");

  if (isDefault) {
    await clearDefaultTikTokChannel(shopId);
  }

  const [channel] = await db
    .insert(tiktokChannels)
    .values({
      shopId,
      tiktokUsername: normalizedUsername,
      displayName: displayName ?? null,
      isDefault,
    })
    .returning();

  if (isDefault) {
    await updateShopDefaultTikTokUsername(shopId, normalizedUsername);
  }

  return channel;
}

export async function updateTikTokChannel({
  shopId,
  channelId,
  tiktokUsername,
  displayName,
  isDefault,
}: {
  shopId: string;
  channelId: string;
  tiktokUsername?: string | null;
  displayName?: string | null;
  isDefault?: boolean;
}) {
  const patch: Record<string, unknown> = { updatedAt: new Date() };

  if (typeof tiktokUsername === "string") {
    const normalizedUsername = normalizeAtUsername(tiktokUsername);
    if (!normalizedUsername) throw badRequest("Thiếu TikTok username.");
    patch.tiktokUsername = normalizedUsername;
  }

  if (typeof displayName === "string") patch.displayName = displayName || null;

  if (isDefault === true) {
    await clearDefaultTikTokChannel(shopId);
    patch.isDefault = true;
  }

  const [updated] = await db
    .update(tiktokChannels)
    .set(patch)
    .where(and(eq(tiktokChannels.id, channelId), eq(tiktokChannels.shopId, shopId)))
    .returning();

  if (!updated) throw notFound("Không tìm thấy kênh TikTok.");

  if (updated.isDefault) {
    await updateShopDefaultTikTokUsername(shopId, updated.tiktokUsername);
  }

  return updated;
}

export async function deleteTikTokChannel({ shopId, channelId }: { shopId: string; channelId: string }) {
  const rows = await db
    .select()
    .from(tiktokChannels)
    .where(and(eq(tiktokChannels.id, channelId), eq(tiktokChannels.shopId, shopId)))
    .limit(1);

  const channel = rows[0];
  if (!channel) throw notFound("Không tìm thấy kênh TikTok.");

  await db
    .delete(tiktokChannels)
    .where(and(eq(tiktokChannels.id, channelId), eq(tiktokChannels.shopId, shopId)));

  if (channel.isDefault) {
    const remaining = await listTikTokChannels(shopId);
    const nextDefault = remaining[0] ?? null;
    if (nextDefault) {
      await updateTikTokChannel({ shopId, channelId: nextDefault.id, isDefault: true });
    } else {
      await updateShopDefaultTikTokUsername(shopId, null);
    }
  }

  return { success: true };
}

async function clearDefaultTikTokChannel(shopId: string) {
  await db
    .update(tiktokChannels)
    .set({ isDefault: false, updatedAt: new Date() })
    .where(and(eq(tiktokChannels.shopId, shopId), eq(tiktokChannels.isDefault, true)));
}

async function updateShopDefaultTikTokUsername(shopId: string, tiktokUsername: string | null) {
  await db
    .update(shops)
    .set({ defaultTikTokUsername: tiktokUsername, updatedAt: new Date() })
    .where(eq(shops.id, shopId));
}
