import { supabaseAdmin } from "../lib/supabase.js";
import { calcDurationSeconds, nowIso } from "../utils/date.js";
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
  commentCount,
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

  if (!externalSessionId) {
    throw new Error("Thiếu sessionId.");
  }

  const now = new Date().toISOString();
  const normalizedUsername = normalizeAtUsername(username);

  let existed = await findLiveSessionByExternalId({
    shopId,
    sessionId: externalSessionId,
  });

  if (!existed && isUuid(externalSessionId)) {
    const { data, error } = await supabaseAdmin
      .from("live_sessions")
      .select("*")
      .eq("shop_id", shopId)
      .eq("id", externalSessionId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    existed = data;
  }

  if (!existed && normalizedUsername) {
    const { data, error } = await supabaseAdmin
      .from("live_sessions")
      .select("*")
      .eq("shop_id", shopId)
      .eq("tiktok_username", normalizedUsername)
      .eq("status", "running")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw new Error(error.message);
    existed = data;
  }

  const finalStartedAt = startedAt || existed?.started_at || now;

  const finalDurationSeconds =
    typeof durationSeconds === "number"
      ? durationSeconds
      : calcDurationSeconds(finalStartedAt, endedAt);

  let finalCommentCount = commentCount;

  if (typeof finalCommentCount !== "number" && existed?.id) {
    const { count, error: countError } = await supabaseAdmin
      .from("live_comments")
      .select("id", { count: "exact", head: true })
      .eq("shop_id", shopId)
      .eq("live_session_id", existed.id);

    if (countError) {
      throw new Error(countError.message);
    }

    finalCommentCount = count || 0;
  }

  if (typeof finalCommentCount !== "number") {
    finalCommentCount = existed?.comment_count || 0;
  }

  const status = reason === "live_error" ? "error" : "ended";

  if (existed) {
    const { data, error } = await supabaseAdmin
      .from("live_sessions")
      .update({
        tiktok_username: normalizedUsername,
        started_at: finalStartedAt,
        ended_at: endedAt,
        duration_seconds: finalDurationSeconds,
        comment_count: finalCommentCount,
        status,
        end_reason: reason,
        updated_at: now,
      })
      .eq("id", existed.id)
      .select("*")
      .single();

    if (error) {
      throw new Error(error.message);
    }

    return data;
  }

  const { data, error } = await supabaseAdmin
    .from("live_sessions")
    .insert({
      shop_id: shopId,
      created_by: userId,
      external_session_id: existed?.external_session_id || externalSessionId,
      tiktok_username: normalizedUsername,
      started_at: finalStartedAt,
      ended_at: endedAt,
      duration_seconds: finalDurationSeconds,
      comment_count: finalCommentCount,
      order_count: 0,
      customer_count: 0,
      status,
      end_reason: reason,
      created_at: now,
      updated_at: now,
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

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

export function mapLiveSession(row: any) {
  return {
    ...row,

    // snake_case giữ cho DB
    started_at: row.started_at,
    ended_at: row.ended_at,
    duration_seconds: row.duration_seconds || 0,
    comment_count: row.comment_count || 0,
    order_count: row.order_count || 0,

    // camelCase cho client dễ dùng
    id: row.id,
    shopId: row.shop_id,
    externalSessionId: row.external_session_id,
    tiktokUsername: row.tiktok_username,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    durationSeconds: row.duration_seconds || 0,
    commentCount: row.comment_count || 0,
    orderCount: row.order_count || 0,
    endReason: row.end_reason,
    status: row.status,
  };
}

export async function getOrCreateRunningLiveSession({
  shopId,
  tiktokUsername,
  externalSessionId,
  startedAt,
}: {
  shopId: string;
  tiktokUsername: string;
  externalSessionId?: string | null;
  startedAt?: string | null;
}) {
  const normalizedUsername = String(tiktokUsername || "").trim();

  if (externalSessionId) {
    const { data: existing, error: findError } = await supabaseAdmin
      .from("live_sessions")
      .select("*")
      .eq("shop_id", shopId)
      .eq("external_session_id", externalSessionId)
      .maybeSingle();

    if (findError) throw new Error(findError.message);
    if (existing) return existing;
  }

  const { data: running, error: runningError } = await supabaseAdmin
    .from("live_sessions")
    .select("*")
    .eq("shop_id", shopId)
    .eq("tiktok_username", normalizedUsername)
    .eq("status", "running")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (runningError) throw new Error(runningError.message);
  if (running) return running;

  const { data, error } = await supabaseAdmin
    .from("live_sessions")
    .insert({
      shop_id: shopId,
      tiktok_username: normalizedUsername,
      external_session_id: externalSessionId || crypto.randomUUID(),
      started_at: startedAt || nowIso(),
      status: "running",
      comment_count: 0,
      order_count: 0,
      duration_seconds: 0,
      updated_at: nowIso(),
    })
    .select("*")
    .single();

  if (error) throw new Error(error.message);

  return data;
}

export async function endRunningLiveSession({
  shopId,
  tiktokUsername,
  liveSessionId,
  externalSessionId,
  reason = "manual_stop",
  endedAt,
}: {
  shopId: string;
  tiktokUsername?: string | null;
  liveSessionId?: string | null;
  externalSessionId?: string | null;
  reason?: string;
  endedAt?: string | null;
}) {
  const finalEndedAt = endedAt || nowIso();
  const normalizedUsername = normalizeAtUsername(tiktokUsername);

  let query = supabaseAdmin
    .from("live_sessions")
    .select("*")
    .eq("shop_id", shopId);

  if (liveSessionId) {
    query = query.eq("id", liveSessionId);
  } else if (externalSessionId) {
    query = query.eq("external_session_id", externalSessionId);
  } else if (normalizedUsername) {
    query = query
      .eq("tiktok_username", normalizedUsername)
      .eq("status", "running")
      .order("started_at", { ascending: false })
      .limit(1);
  } else {
    query = query
      .eq("status", "running")
      .order("started_at", { ascending: false })
      .limit(1);
  }

  const { data: session, error: findError } = await query.maybeSingle();

  if (findError) throw new Error(findError.message);

  if (!session && normalizedUsername && !liveSessionId && !externalSessionId) {
    const { data: fallbackSession, error: fallbackError } = await supabaseAdmin
      .from("live_sessions")
      .select("*")
      .eq("shop_id", shopId)
      .eq("status", "running")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (fallbackError) throw new Error(fallbackError.message);
    if (fallbackSession) {
      const durationSeconds = calcDurationSeconds(fallbackSession.started_at, finalEndedAt);
      const { data, error } = await supabaseAdmin
        .from("live_sessions")
        .update({
          ended_at: finalEndedAt,
          duration_seconds: durationSeconds,
          end_reason: reason,
          status: "ended",
          updated_at: nowIso(),
        })
        .eq("id", fallbackSession.id)
        .select("*")
        .single();

      if (error) throw new Error(error.message);
      return data;
    }
  }

  if (!session) return null;

  const durationSeconds = calcDurationSeconds(session.started_at, finalEndedAt);

  const { data, error } = await supabaseAdmin
    .from("live_sessions")
    .update({
      ended_at: finalEndedAt,
      duration_seconds: durationSeconds,
      end_reason: reason,
      status: "ended",
      updated_at: nowIso(),
    })
    .eq("id", session.id)
    .select("*")
    .single();

  if (error) throw new Error(error.message);

  return data;
}

export async function updateLiveSessionCommentCount(liveSessionId: string) {
  if (!liveSessionId) return;

  const { count, error: countError } = await supabaseAdmin
    .from("live_comments")
    .select("id", { count: "exact", head: true })
    .eq("live_session_id", liveSessionId);

  if (countError) throw new Error(countError.message);

  const { data: session, error: sessionError } = await supabaseAdmin
    .from("live_sessions")
    .select("started_at,ended_at,status")
    .eq("id", liveSessionId)
    .maybeSingle();

  if (sessionError) throw new Error(sessionError.message);

  const now = nowIso();
  const durationSeconds = calcDurationSeconds(session?.started_at, session?.ended_at || now);

  const { error } = await supabaseAdmin
    .from("live_sessions")
    .update({
      comment_count: count || 0,
      duration_seconds: durationSeconds,
      updated_at: now,
    })
    .eq("id", liveSessionId);

  if (error) throw new Error(error.message);
}

export async function getLiveSessionHistory({
  shopId,
  limit = 100,
}: {
  shopId: string;
  limit?: number;
}) {
  const { data, error } = await supabaseAdmin
    .from("live_sessions")
    .select(`
      *,
      comments:live_comments(*),
      orders(*)
    `)
    .eq("shop_id", shopId)
    .order("started_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);

  return (data || []).map((session) => {
    const startedAt = session.started_at;
    const endedAt = session.ended_at;

    const durationSeconds =
      session.duration_seconds ||
      calcDurationSeconds(startedAt, endedAt || new Date().toISOString());

    return mapLiveSession({
      ...session,
      duration_seconds: durationSeconds,
      comments: session.comments || [],
      orders: session.orders || [],
    });
  });
}