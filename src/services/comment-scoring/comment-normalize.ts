import { decodeTikTokEmoji } from "../../utils/tiktokEmoji.js";

export function removeVietnameseAccents(input: string) {
  return String(input || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
}

export const META_NOISE_PATTERNS = [
  /\b(top fan|topfans|top fan vibe|fans|new engager|follower)\b/gi,
  /\b@\w+/g,
  /\[[^\]]+\]/g,
  /\(team|team lumi|official\)/gi,
];

// ponytail: sticker/emoji-only — after stripping emoji+brackets empty + had at least one token = SKIP
const EMOJI_G = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}]/gu;
const EMOJI_RE = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}]/u;
const BRACKET_TOKEN_RE = /\[[^\]]+\]/g;

export function isStickerOrEmojiOnly(raw: string): boolean {
  const s = String(raw || "").trim();
  if (!s) return false;
  const decoded = decodeTikTokEmoji(s);
  const withoutEmoji = decoded.replace(EMOJI_G, "").replace(BRACKET_TOKEN_RE, "").trim();
  if (withoutEmoji.length > 0) return false;
  return EMOJI_RE.test(decoded) || BRACKET_TOKEN_RE.test(s);
}

export function stripMetadataNoise(text: string) {
  return META_NOISE_PATTERNS.reduce((acc, pattern) => acc.replace(pattern, " "), text)
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeComment(input: string) {
  return removeVietnameseAccents(input).toLowerCase().replace(/\s+/g, " ").trim();
}

// ponytail: normalize — collapse repeated punctuation (!!!→!, ???→?), keep rawText separate
export function normalizeRepeatedPunctuation(input: string): string {
  return String(input || "")
    .replace(/([!?.])\1{1,}/g, "$1")
    .replace(/\s+([!?.])/g, "$1");
}

export type NormalizedComment = { raw: string; clean: string };

export function normalizeCommentWithRaw(raw: string): NormalizedComment {
  const decoded = decodeTikTokEmoji(String(raw || ""));
  const stripped = stripMetadataNoise(decoded);
  const punctFixed = normalizeRepeatedPunctuation(stripped);
  return { raw: String(raw || "").trim(), clean: normalizeComment(punctFixed) };
}

// ponytail: single entry — decode emoji → strip badge/handle noise → repeated punct → NFD+lower+collapse
export function normalizeRawComment(raw: string) {
  return normalizeCommentWithRaw(raw).clean;
}
