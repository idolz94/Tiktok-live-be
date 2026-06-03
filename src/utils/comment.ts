import { getCommentTikTokUsername } from "./tiktok.js";

export function getCommentText(comment: any) {
  return String(
    comment?.commentText ||
      comment?.comment_text ||
      comment?.text ||
      comment?.comment ||
      comment?.message ||
      comment?.rawText ||
      comment?.raw_text ||
      "",
  ).trim();
}

export function getCommentDisplayName(comment: any) {
  return String(
    comment?.displayName ||
      comment?.display_name ||
      comment?.username ||
      comment?.nickname ||
      comment?.name ||
      getCommentTikTokUsername(comment) ||
      "Khách live",
  ).trim();
}

export function getCommentAvatar(comment: any) {
  return String(comment?.avatar || comment?.avatarUrl || comment?.avatar_url || comment?.profilePictureUrl || "").trim();
}

export function hasNumber(text: string) {
  return /\d/.test(text);
}
