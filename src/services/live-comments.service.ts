import { supabaseAdmin } from "../lib/supabase.js";
import { getCommentAvatar, getCommentDisplayName, getCommentText, hasNumber } from "../utils/comment.js";
import { getCommentTikTokUsername, normalizeAtUsername } from "../utils/tiktok.js";
import { updateLiveSessionCommentCount } from "./live-sessions.service.js";

export async function saveLiveComment({
  shopId,
  liveSessionId,
  comment,
}: {
  shopId: string;
  liveSessionId: string;
  comment: any;
}) {
  if (!liveSessionId) return null;

  const commentText = getCommentText(comment);
  if (!commentText) return null;

  const externalCommentId = String(comment?.id || comment?.externalCommentId || comment?.external_comment_id || "").trim();
  if (!externalCommentId) return null;

  const now = new Date().toISOString();
  const payload = {
    shop_id: shopId,
    live_session_id: liveSessionId,
    external_comment_id: externalCommentId,
    tiktok_comment_id: externalCommentId,
    tiktok_username: normalizeAtUsername(getCommentTikTokUsername(comment)),
    tiktok_unique_id: normalizeAtUsername(getCommentTikTokUsername(comment)).replace(/^@/, ""),
    display_name: getCommentDisplayName(comment),
    avatar_url: getCommentAvatar(comment),
    comment_text: commentText,
    text: commentText,
    raw_text: String(comment?.rawText || comment?.raw_text || commentText).trim(),
    intent: comment?.intent || "normal",
    priority_level: comment?.priorityLevel || comment?.priority_level || "normal",
    final_score: Number(comment?.finalScore || comment?.final_score || 0),
    has_number: hasNumber(commentText),
    can_create_order: true,
    is_order_created: Boolean(comment?.isOrderCreated || comment?.is_order_created),
    order_id: comment?.orderId || comment?.order_id || null,
    // raw_payload is useful for debugging, but keep it disabled unless your DB has this column.
    // raw_payload: comment?.rawPayload || comment?.raw_payload || comment,
    updated_at: now,
  };

  const { data, error } = await supabaseAdmin
    .from("live_comments")
    .upsert(payload, { onConflict: "shop_id,external_comment_id" })
    .select("*")
    .single();

  if (error) throw new Error(error.message);

  await updateLiveSessionCommentCount(liveSessionId);

  return data;
}

export async function findDbLiveCommentId({
  shopId,
  comment,
}: {
  shopId: string;
  comment: any;
}) {
  const commentRecord = comment as Record<string, any>;

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (uuidRegex.test(String(commentRecord.dbId || ""))) return String(commentRecord.dbId);
  if (uuidRegex.test(String(commentRecord.liveCommentId || ""))) return String(commentRecord.liveCommentId);

  const externalCommentId = String(commentRecord.id || commentRecord.externalCommentId || "").trim();
  if (!externalCommentId) return null;

  const { data, error } = await supabaseAdmin
    .from("live_comments")
    .select("id")
    .eq("shop_id", shopId)
    .eq("external_comment_id", externalCommentId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data?.id || null;
}

export async function updateLiveCommentOrder({
  commentId,
  orderId,
}: {
  commentId?: string | null;
  orderId: string;
}) {
  if (!commentId) return;

  const { error } = await supabaseAdmin
    .from("live_comments")
    .update({ is_order_created: true, order_id: orderId, updated_at: new Date().toISOString() })
    .eq("id", commentId);

  if (error) throw new Error(error.message);
}
