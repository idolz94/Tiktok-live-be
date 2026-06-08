import { supabaseAdmin } from "../lib/supabase.js";
import { getCommentAvatar, getCommentDisplayName, getCommentText, hasNumber } from "../utils/comment.js";
import { getCommentTikTokUsername, normalizeAtUsername } from "../utils/tiktok.js";
import { analyzeLiveCommentIntent } from "../utils/comment-intent.js";
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
  const tiktokUsername = normalizeAtUsername(getCommentTikTokUsername(comment));

  const intentResult = analyzeLiveCommentIntent(commentText);

  const payload = {
    shop_id: shopId,
    live_session_id: liveSessionId,
    external_comment_id: externalCommentId,
    tiktok_comment_id: externalCommentId,

    tiktok_username: tiktokUsername,
    tiktok_unique_id: tiktokUsername.replace(/^@/, ""),

    display_name: getCommentDisplayName(comment),
    avatar_url: getCommentAvatar(comment),

    comment_text: commentText,
    text: commentText,
    raw_text: String(comment?.rawText || comment?.raw_text || commentText).trim(),

    intent: intentResult.intent,
    priority_level: intentResult.priorityLevel,
    final_score: intentResult.finalScore,

    has_number: hasNumber(commentText),

    can_create_order: intentResult.canCreateOrder,
    is_order_created: Boolean(comment?.isOrderCreated || comment?.is_order_created),
    order_id: comment?.orderId || comment?.order_id || null,

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

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;
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