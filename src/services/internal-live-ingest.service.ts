import { eq, or } from "drizzle-orm";
import { db } from "../lib/db.js";
import { shopMembers, shops } from "../db/schema/index.js";
import { normalizeAtUsername } from "../utils/tiktok.js";
import { saveLiveComment } from "./live-comments.service.js";
import { findLiveSessionByExternalId, startLiveSession } from "./live-sessions.service.js";

export async function findShopOwnerUserId(shopId: string) {
  const rows = await db
    .select({ userId: shopMembers.userId })
    .from(shopMembers)
    .where(eq(shopMembers.shopId, shopId))
    .limit(1);
  return rows[0]?.userId ?? null;
}

export async function resolveShopForCollectorEvent({
  shopId,
  liveUsername,
}: {
  shopId?: string | null;
  liveUsername?: string | null;
}) {
  if (shopId) {
    const rows = await db.select().from(shops).where(eq(shops.id, shopId)).limit(1);
    if (rows[0]) return rows[0];
  }

  const username = normalizeAtUsername(String(liveUsername || ""));
  if (!username) return null;

  const withAt = username.startsWith("@") ? username : `@${username}`;
  const withoutAt = username.replace(/^@/, "");

  const rows = await db
    .select()
    .from(shops)
    .where(
      or(
        eq(shops.defaultTikTokUsername, withAt),
        eq(shops.defaultTikTokUsername, withoutAt),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

export async function ensureCollectorLiveSession({
  shopId,
  userId,
  liveUsername,
  collectorSessionId,
  startedAt,
}: {
  shopId: string;
  userId?: string | null;
  liveUsername: string;
  collectorSessionId: string;
  startedAt: string;
}) {
  const existed = await findLiveSessionByExternalId({ shopId, sessionId: collectorSessionId });
  if (existed) return existed;

  const finalUserId = userId || await findShopOwnerUserId(shopId);
  if (!finalUserId) throw new Error("Không tìm thấy user sở hữu shop để tạo live session.");

  return startLiveSession({
    shopId,
    userId: finalUserId,
    sessionId: collectorSessionId,
    username: liveUsername,
    startedAt,
  });
}

export async function ingestCollectorComment({
  shopId,
  liveUsername,
  collectorSessionId,
  comment,
  createdAt,
}: {
  shopId?: string | null;
  liveUsername: string;
  collectorSessionId: string;
  comment: any;
  createdAt: string;
}) {
  const shop = await resolveShopForCollectorEvent({ shopId, liveUsername });
  if (!shop?.id) {
    throw new Error(
      `Không tìm thấy shop cho TikTok username ${liveUsername}. Hãy set shops.default_tiktok_username hoặc gửi shopId từ collector.`,
    );
  }

  const session = await ensureCollectorLiveSession({
    shopId: shop.id,
    liveUsername,
    collectorSessionId,
    startedAt: createdAt,
  });

  const savedComment = await saveLiveComment({
    shopId: shop.id,
    liveSessionId: session.id,
    comment,
    liveUsername,
  });

  return { shop, session, comment: savedComment };
}
