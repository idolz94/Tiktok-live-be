import { supabaseAdmin } from "../lib/supabase.js";
import { normalizeAtUsername } from "../utils/tiktok.js";
import { saveLiveComment } from "./live-comments.service.js";
import { findLiveSessionByExternalId, startLiveSession } from "./live-sessions.service.js";

function normalizeUsername(value: string) {
  return normalizeAtUsername(value || "");
}

export async function findShopOwnerUserId(shopId: string) {
  const { data, error } = await supabaseAdmin
    .from("shop_members")
    .select("user_id")
    .eq("shop_id", shopId)
    .eq("status", "active")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data?.user_id || null;
}

export async function resolveShopForCollectorEvent({
  shopId,
  liveUsername,
}: {
  shopId?: string | null;
  liveUsername?: string | null;
}) {
  if (shopId) {
    const { data, error } = await supabaseAdmin.from("shops").select("*").eq("id", shopId).maybeSingle();
    if (error) throw new Error(error.message);
    if (data) return data;
  }

  const username = normalizeUsername(String(liveUsername || ""));
  if (!username) return null;

  const { data, error } = await supabaseAdmin
    .from("shops")
    .select("*")
    .or(`default_tiktok_username.eq.${username},default_tiktok_username.eq.${username.replace(/^@/, "")}`)
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data || null;
}

export async function ensureCollectorLiveSession({
  shopId,
  liveUsername,
  collectorSessionId,
  startedAt,
}: {
  shopId: string;
  liveUsername: string;
  collectorSessionId: string;
  startedAt: string;
}) {
  const existed = await findLiveSessionByExternalId({ shopId, sessionId: collectorSessionId });
  if (existed) return existed;

  const ownerUserId = await findShopOwnerUserId(shopId);
  if (!ownerUserId) throw new Error("Không tìm thấy user sở hữu shop để tạo live session.");

  return startLiveSession({
    shopId,
    userId: ownerUserId,
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
      `Không tìm thấy shop cho TikTok username ${liveUsername}. Hãy set shops.default_tiktok_username hoặc gửi shopId từ Python.`,
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
  });

  return {
    shop,
    session,
    comment: savedComment,
  };
}
