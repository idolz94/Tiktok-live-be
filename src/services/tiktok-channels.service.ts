import { eq, and, desc } from "drizzle-orm";
import { db } from "../lib/db.js";
import { tiktokChannels, shops } from "../db/schema/index.js";
import { badRequest, notFound } from "../lib/api-error.js";
import { env } from "../config/env.js";
import { normalizeAtUsername } from "../utils/tiktok.js";

interface TikTokProfile {
  displayName: string | null;
  avatarUrl: string | null;
  followerCount: number | null;
}

type EulerBasicUser = {
  nickname?: string | null;
  avatar_thumb?: string[] | null;
  avatar_medium?: string[] | null;
  avatar_larger?: string[] | null;
};

async function fetchTikTokProfile(username: string): Promise<TikTokProfile> {
  try {
    const url = `${env.eulerApiBase}/tiktok/users/${encodeURIComponent(username)}/basic`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${env.eulerApiKey}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { displayName: null, avatarUrl: null, followerCount: null };

    const json = await res.json() as { code?: number; user?: EulerBasicUser };
    const user = json.code === 200 ? json.user : null;
    if (!user) return { displayName: null, avatarUrl: null, followerCount: null };

    return {
      displayName: user.nickname ?? null,
      avatarUrl: user.avatar_thumb?.[0] ?? user.avatar_medium?.[0] ?? user.avatar_larger?.[0] ?? null,
      // ponytail: Euler full profile with follower count requires Business plan; roomInfo backfills later when live connects.
      followerCount: null,
    };
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

  let newUsername: string | undefined;

  if (typeof tiktokUsername === "string") {
    const normalizedUsername = normalizeAtUsername(tiktokUsername);
    if (!normalizedUsername) throw badRequest("Thiếu TikTok username.");
    patch.tiktokUsername = normalizedUsername;
    newUsername = normalizedUsername;
    // ponytail: clear stale profile so GET list backfills fresh data after background fetch.
    patch.avatarUrl = null;
    if (typeof displayName !== "string") patch.displayName = null;
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

  // When username changes, refresh profile in background (avatar + displayName if not explicitly set).
  if (newUsername) {
    fetchTikTokProfile(newUsername).then((profile) => {
      const profilePatch: { displayName?: string | null; avatarUrl?: string | null } = {};
      // Only override displayName from Euler if caller didn't supply one explicitly.
      if (typeof displayName !== "string" && profile.displayName) {
        profilePatch.displayName = profile.displayName;
      }
      if (profile.avatarUrl) profilePatch.avatarUrl = profile.avatarUrl;
      if (Object.keys(profilePatch).length > 0) {
        updateTikTokChannelProfile(shopId, newUsername!, profilePatch).catch(() => {});
      }
    }).catch(() => {});
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
