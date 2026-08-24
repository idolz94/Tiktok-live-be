// ponytail: stage FILTER — loại sớm những comment KHÔNG BAO GIỜ cần chấm điểm hay gọi LLM
// (sticker, system event, noise, host). Chạy trước rule engine để tiết kiệm CPU/LLM.
// Mỗi hàm trả về SkipReason hoặc null; thứ tự check nằm ở `detectPreFilterSkip`.

import type { SkipReason } from "./comment-types.js";
import { ROUTING } from "./comment-config.js";
import { isStickerOrEmojiOnly } from "./comment-normalize.js";

const SYSTEM_EVENT_PATTERNS: RegExp[] = [
  /\b(joined|followed|shared|sent a gift|tapped the screen)\b/i,
  /^(joined|followed)\b/i,
  /^[\s]*@\w+\s*(joined|followed|shared)/i,
];

const NOISE_ONLY_PATTERNS: RegExp[] = [
  /^[@\s]+$/,
  /^[.\s,…\-_]+$/,
  /^haha+$/i,
  /^kkk+$/i,
  /^oke+$/i,
];

export function isSystemEvent(text: string): boolean {
  return SYSTEM_EVENT_PATTERNS.some((p) => p.test(text));
}

export function isNoiseOnly(text: string): boolean {
  if (text.length <= 1) return true;
  return NOISE_ONLY_PATTERNS.some((p) => p.test(text.trim()));
}

/**
 * Check trước khi normalize (cần raw để nhận sticker "[wow]" / emoji).
 */
export function detectRawSkip(raw: string): SkipReason | null {
  if (isStickerOrEmojiOnly(raw)) return "sticker_or_emoji_only";
  return null;
}

/**
 * Check sau khi normalize. `raw` vẫn được truyền vào vì system-event pattern có thể match
 * trên raw ("@abc followed") mà mất sau khi strip @handle.
 */
export function detectCleanSkip(raw: string, clean: string, isHost: boolean): SkipReason | null {
  if (!clean || clean.length < ROUTING.minTextLength) return "empty_or_too_short";
  if (isSystemEvent(raw) || isSystemEvent(clean)) return "system_event";
  if (isNoiseOnly(clean)) return "noise_only";
  if (isHost) return "host_comment";
  return null;
}
