import { eq, and, desc } from "drizzle-orm";
import { db } from "../lib/db.js";
import { tiktokChannels, shops } from "../db/schema/index.js";
import { badRequest, notFound } from "../lib/api-error.js";
import { normalizeAtUsername } from "../utils/tiktok.js";
// @ts-ignore — tiktok-live-connector ships ESM without declaration files
import { TikTokLiveConnection } from "tiktok-live-connector";

interface TikTokProfile {
  displayName: string | null;
  avatarUrl: string | null;
  followerCount: number | null;
}

export async function fetchTikTokProfile(username: string): Promise<TikTokProfile> {
  try {
    // @ts-ignore
    const connection = new TikTokLiveConnection(username);
    const roomInfo = await connection.fetchRoomInfo();
    const owner = roomInfo?.data?.owner ?? roomInfo?.data?.user ?? null;
    if (!owner) return { displayName: null, avatarUrl: null, followerCount: null };

    const displayName: string | null = owner.nickname ?? null;
    const avatarUrl: string | null =
      owner.avatarThumb?.urlList?.[0] ?? owner.avatarThumb?.url ?? null;
    const rawCount = owner.followInfo?.followerCount;
    const followerCount: number | null =
      typeof rawCount === "number"
        ? rawCount
        : typeof rawCount === "string"
        ? parseInt(rawCount, 10) || null
        : null;

    return { displayName, avatarUrl, followerCount };
  } catch {
    return { displayName: null, avatarUrl: null, followerCount: null };
  }
}

export async function listTikTokChannels(shopId: string) {
  return db
    .select()
    .from(tiktokChannels)
    .where(eq(tiktokChannels.shopId, shopId))
    .orderBy(desc(tiktokChannels.isDefault), tiktokChannels.createdAt);
}

export async function listTikTokChannelsWithBackfill(shopId: string) {
  const rows = await listTikTokChannels(shopId);
  const needsBackfill = rows.filter((c) => !c.avatarUrl);
  if (needsBackfill.length === 0) return rows;

  const backfilled = await Promise.allSettled(
    needsBackfill.map(async (c) => {
      const profile = await fetchTikTokProfile(c.tiktokUsername);
      if (profile.avatarUrl) {
        await updateTikTokChannelProfile(shopId, c.tiktokUsername, profile);
      }
      return { id: c.id, ...profile };
    }),
  );

  const enriched = new Map(
    backfilled
      .flatMap((r) => (r.status === "fulfilled" ? [r.value] : []))
      .map((v) => [v.id, v]),
  );

  return rows.map((c) => {
    const e = enriched.get(c.id);
    if (!e) return c;
    return {
      ...c,
      displayName: e.displayName ?? c.displayName,
      avatarUrl: e.avatarUrl ?? c.avatarUrl,
      followerCount: e.followerCount ?? c.followerCount,
    };
  });
}

async function fetchDisplayNameFromOEmbed(username: string): Promise<string | null> {
  try {
    const url = `https://www.tiktok.com/oembed?url=https://www.tiktok.com/@${encodeURIComponent(username)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const json = await res.json() as { author_name?: string };
    return json.author_name ?? null;
  } catch {
    return null;
  }
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

  const profile = await fetchTikTokProfile(normalizedUsername);
  const resolvedDisplayName =
    displayName ?? profile.displayName ?? (await fetchDisplayNameFromOEmbed(normalizedUsername));

  const [channel] = await db
    .insert(tiktokChannels)
    .values({
      shopId,
      tiktokUsername: normalizedUsername,
      displayName: resolvedDisplayName ?? null,
      avatarUrl: profile.avatarUrl ?? null,
      followerCount: profile.followerCount ?? null,
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

export async function updateTikTokChannelProfile(
  shopId: string,
  tiktokUsername: string,
  profile: { displayName?: string | null; avatarUrl?: string | null; followerCount?: number | null },
): Promise<void> {
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (profile.displayName !== undefined) patch.displayName = profile.displayName;
  if (profile.avatarUrl !== undefined) patch.avatarUrl = profile.avatarUrl;
  if (profile.followerCount !== undefined) patch.followerCount = profile.followerCount;

  await db
    .update(tiktokChannels)
    .set(patch)
    .where(
      and(
        eq(tiktokChannels.shopId, shopId),
        eq(tiktokChannels.tiktokUsername, tiktokUsername),
      ),
    );
}
