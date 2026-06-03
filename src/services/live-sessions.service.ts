import { supabaseAdmin } from "../lib/supabase.js";
import { calcDurationSeconds } from "../utils/date.js";
import { isUuid } from "../utils/id.js";
import { normalizeAtUsername } from "../utils/tiktok.js";

export async function findLiveSessionByExternalId({
  shopId,
  sessionId,
}: {
  shopId: string;
  sessionId: string;
}) {
  const { data, error } = await supabaseAdmin
    .from("live_sessions")
    .select("*")
    .eq("shop_id", shopId)
    .eq("external_session_id", sessionId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data;
}

export async function startLiveSession({
  shopId,
  userId,
  sessionId,
  username,
  startedAt,
}: {
  shopId: string;
  userId: string;
  sessionId: string;
  username: string;
  startedAt: string;
}) {
  const externalSessionId = String(sessionId || "").trim();
  if (!externalSessionId) throw new Error("Thiếu sessionId.");

  const existed = await findLiveSessionByExternalId({ shopId, sessionId: externalSessionId });
  const now = new Date().toISOString();

  if (existed) {
    const { data, error } = await supabaseAdmin
      .from("live_sessions")
      .update({
        tiktok_username: normalizeAtUsername(username),
        started_at: startedAt,
        status: "running",
        ended_at: null,
        end_reason: null,
        updated_at: now,
      })
      .eq("id", existed.id)
      .select("*")
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  const { data, error } = await supabaseAdmin
    .from("live_sessions")
    .insert({
      shop_id: shopId,
      created_by: userId,
      external_session_id: externalSessionId,
      tiktok_username: normalizeAtUsername(username),
      started_at: startedAt,
      status: "running",
      comment_count: 0,
      order_count: 0,
      customer_count: 0,
      duration_seconds: 0,
      created_at: now,
      updated_at: now,
    })
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function endLiveSession({
  shopId,
  userId,
  sessionId,
  username,
  startedAt,
  endedAt,
  durationSeconds,
  commentCount = 0,
  reason = "live_ended",
}: {
  shopId: string;
  userId: string;
  sessionId: string;
  username: string;
  startedAt?: string | null;
  endedAt: string;
  durationSeconds?: number;
  commentCount?: number;
  reason?: string;
}) {
  const externalSessionId = String(sessionId || "").trim();
  if (!externalSessionId) throw new Error("Thiếu sessionId.");

  const existed = await findLiveSessionByExternalId({ shopId, sessionId: externalSessionId });
  const finalStartedAt = startedAt || existed?.started_at || endedAt || new Date().toISOString();
  const finalDurationSeconds =
    typeof durationSeconds === "number" ? durationSeconds : calcDurationSeconds(finalStartedAt, endedAt);
  const status = reason === "live_error" ? "error" : "ended";
  const now = new Date().toISOString();

  if (existed) {
    const { data, error } = await supabaseAdmin
      .from("live_sessions")
      .update({
        tiktok_username: normalizeAtUsername(username),
        started_at: finalStartedAt,
        ended_at: endedAt,
        duration_seconds: finalDurationSeconds,
        comment_count: commentCount,
        status,
        end_reason: reason,
        updated_at: now,
      })
      .eq("id", existed.id)
      .select("*")
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  const { data, error } = await supabaseAdmin
    .from("live_sessions")
    .insert({
      shop_id: shopId,
      created_by: userId,
      external_session_id: externalSessionId,
      tiktok_username: normalizeAtUsername(username),
      started_at: finalStartedAt,
      ended_at: endedAt,
      duration_seconds: finalDurationSeconds,
      comment_count: commentCount,
      order_count: 0,
      customer_count: 0,
      status,
      end_reason: reason,
      created_at: now,
      updated_at: now,
    })
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function updateLiveSessionOrderCount(liveSessionId?: string | null) {
  if (!isUuid(liveSessionId)) return;

  const { data: liveSession, error: findError } = await supabaseAdmin
    .from("live_sessions")
    .select("id,order_count")
    .eq("id", liveSessionId)
    .maybeSingle();

  if (findError) throw new Error(findError.message);
  if (!liveSession) return;

  const { error } = await supabaseAdmin
    .from("live_sessions")
    .update({
      order_count: Number(liveSession.order_count || 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", liveSessionId);

  if (error) throw new Error(error.message);
}

export async function updateLiveSessionCommentCount(liveSessionId?: string | null) {
  if (!isUuid(liveSessionId)) return;

  const { count, error: countError } = await supabaseAdmin
    .from("live_comments")
    .select("id", { count: "exact", head: true })
    .eq("live_session_id", liveSessionId);

  if (countError) throw new Error(countError.message);

  const { error } = await supabaseAdmin
    .from("live_sessions")
    .update({ comment_count: count || 0, updated_at: new Date().toISOString() })
    .eq("id", liveSessionId);

  if (error) throw new Error(error.message);
}
