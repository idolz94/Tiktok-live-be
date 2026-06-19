export function cleanTikTokUsername(username?: string | null) {
  return String(username || "").trim().replace(/^@/, "").trim();
}

export function normalizeAtUsername(username?: string | null) {
  const value = String(username || "").trim().replace(/^@+/, "");
  return value;
}

export function getCommentTikTokUsername(comment: any) {
  const username = String(
    comment?.customerTikTokName ||
      comment?.customer_tiktok_name ||
      comment?.customerTikTokUsername ||
      comment?.customer_tiktok_username ||
      comment?.tiktokUsername ||
      comment?.tiktok_username ||
      comment?.uniqueId ||
      comment?.unique_id ||
      comment?.tiktokUniqueId ||
      comment?.tiktok_unique_id ||
      comment?.raw?.customerTikTokName ||
      comment?.raw?.customer_tiktok_name ||
      comment?.raw?.customerTikTokUsername ||
      comment?.raw?.customer_tiktok_username ||
      comment?.raw?.tiktokUsername ||
      comment?.raw?.tiktok_username ||
      comment?.raw?.uniqueId ||
      comment?.raw?.unique_id ||
      "",
  ).trim();

  return normalizeAtUsername(username);
}
