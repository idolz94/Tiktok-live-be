import { isStickerOrEmojiOnly, normalizeRawComment } from "./comment-normalize.js";
import { analyzeLiveCommentIntent, type CommentIntentResult } from "./comment-intent.js";
import { extractEntityHints, hasNegation, type EntityHints } from "./comment-extract.js";
import { extractProductReference } from "./comment-extract.js";
import { normalizeComment } from "./comment-normalize.js";
import { stripMetadataNoise } from "./comment-normalize.js";

export type PipelineVerdict = "SKIP" | "RULE_RESOLVED" | "NEED_LLM";

export type PipelineContext = {
  isHost: boolean;
  matchedPresetCode?: string | null;
};

export type PipelineResult =
  | { verdict: "SKIP"; reason: string; intent: string; result: CommentIntentResult; hints: EntityHints; rawText: string }
  | { verdict: "RULE_RESOLVED"; intent: string; result: CommentIntentResult; hints: EntityHints; rawText: string }
  | { verdict: "NEED_LLM"; intent: string; result: CommentIntentResult; hints: EntityHints; rawText: string; missingFields: string[] };

const MIN_TEXT_LENGTH = 2;
const CASUAL_CHAT_SCORE = 25;

// ── [1] FILTER: system/seller/noise patterns that never need LLM
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

function isSystemEvent(text: string): boolean {
  return SYSTEM_EVENT_PATTERNS.some((p) => p.test(text));
}

function isNoiseOnly(text: string): boolean {
  if (text.length <= 1) return true;
  return NOISE_ONLY_PATTERNS.some((p) => p.test(text.trim()));
}

// ── [3] RULE ENGINE — đơn giản hoá theo yêu cầu: chỉ còn 1 ngưỡng điểm quyết định
// SKIP hay RULE_RESOLVED (bỏ các check tinh vi productReference/confidence từng dùng để rơi
// xuống NEED_LLM khi chưa chắc "mua sản phẩm nào"). Đánh đổi: ưu tiên đơn giản/nhanh hơn là
// độ chính xác — vd "chốt mã này" (chưa rõ mã nào) giờ sẽ RULE_RESOLVED thay vì NEED_LLM.
// Lưu ý: verdict ở đây KHÔNG phải cổng an toàn cuối cùng cho việc tự tạo đơn — tiktok-collector
// vẫn tự yêu cầu matchedProductCode khớp thật với catalog của shop (qua matchPresetByComment)
// trước khi thật sự tạo đơn, nên "này"/"kia" không tự nhiên khớp ra 1 sản phẩm thật.

function decideRouting(
  clean: string,
  result: CommentIntentResult,
  hints: EntityHints,
  ctx: PipelineContext,
): PipelineResult | null {
  void ctx; // preset-match override đã xử lý trước khi gọi tới đây, ctx giữ lại cho signature ổn định

  if (result.finalScore < CASUAL_CHAT_SCORE) {
    return { verdict: "SKIP", reason: "low_score", intent: result.intent, result, hints, rawText: clean };
  }

  // ponytail: giữ lại guard phủ định dù đã bỏ các check tinh vi khác — "không lấy S03 đâu" mà
  // vẫn RULE_RESOLVED thành buy là sai nghiêm trọng (có thể tự tạo đơn cho thứ khách từ chối).
  // Đây là an toàn tối thiểu, không phải độ chính xác, nên không bỏ theo yêu cầu đơn giản hoá.
  if (hasNegation(clean) && result.matchedReasons.some((r) => r.includes("mua") || r.includes("lấy") || r.includes("chốt"))) {
    return { verdict: "SKIP", reason: "negated", intent: result.intent, result, hints, rawText: clean };
  }

  return { verdict: "RULE_RESOLVED", intent: result.intent, result, hints, rawText: clean };
}

export function runCommentPipeline(rawText: string, ctx: PipelineContext): PipelineResult {
  const raw = String(rawText || "").trim();

  // ─── [1] FILTER — sticker/emoji-only (before any scoring) ───────
  if (isStickerOrEmojiOnly(raw)) {
    const r = analyzeLiveCommentIntent("");
    const hints: EntityHints = { productCode: null, color: null, size: null, quantity: null, destination: null };
    return { verdict: "SKIP", reason: "sticker_or_emoji_only", intent: "normal", result: r, hints, rawText: raw };
  }

  // ─── [2] NORMALIZE — whitespace, unicode, repeated punct, keep raw ─
  const clean = normalizeRawComment(raw);

  // ─── [1] FILTER (cont.) — empty / too short / system event / noise ─
  if (!clean || clean.length < MIN_TEXT_LENGTH) {
    const r = analyzeLiveCommentIntent("");
    const hints: EntityHints = { productCode: null, color: null, size: null, quantity: null, destination: null };
    return { verdict: "SKIP", reason: "empty_or_too_short", intent: "normal", result: r, hints, rawText: raw };
  }
  if (isSystemEvent(raw) || isSystemEvent(clean)) {
    const r = analyzeLiveCommentIntent(clean);
    const hints: EntityHints = { productCode: null, color: null, size: null, quantity: null, destination: null };
    return { verdict: "SKIP", reason: "system_event", intent: "normal", result: r, hints, rawText: raw };
  }
  if (isNoiseOnly(clean)) {
    const r = analyzeLiveCommentIntent("");
    const hints: EntityHints = { productCode: null, color: null, size: null, quantity: null, destination: null };
    return { verdict: "SKIP", reason: "noise_only", intent: "normal", result: r, hints, rawText: raw };
  }
  if (ctx.isHost) {
    const r = analyzeLiveCommentIntent(clean);
    r.intent = "user";
    r.priorityLevel = "normal";
    r.finalScore = 0;
    r.canSuggestOrder = false;
    r.canCreateDraftOrder = false;
    r.canCreateOrder = false;
    r.isPotentialBuyer = false;
    const hints: EntityHints = { productCode: null, color: null, size: null, quantity: null, destination: null };
    return { verdict: "SKIP", reason: "host_comment", intent: "user", result: r, hints, rawText: raw };
  }

  // ─── entity hints — extract BEFORE routing, available even for NEED_LLM ─
  const productRef = extractProductReference(normalizeComment(stripMetadataNoise(raw)));
  const hints: EntityHints = extractEntityHints(clean, productRef);

  // ─── [3] DETERMINISTIC RULES ──────────────────────────────────────
  const result = analyzeLiveCommentIntent(clean, { shopBoost: !!ctx.matchedPresetCode });
  if (result.intent === "spam") {
    return { verdict: "SKIP", reason: "spam_detected", intent: "spam", result, hints, rawText: raw };
  }

  // ponytail: preset match — only RULE_RESOLVED if no negation
  if (ctx.matchedPresetCode && result.intent !== "user" && !hasNegation(clean)) {
    result.intent = "buy";
    result.priorityLevel = "high";
    result.finalScore = Math.max(result.finalScore, 90);
    result.canCreateDraftOrder = true;
    result.canCreateOrder = true;
    result.isPotentialBuyer = true;
    if (result.parsedData) result.parsedData.productCode = ctx.matchedPresetCode;
    hints.productCode = ctx.matchedPresetCode;
    return { verdict: "RULE_RESOLVED", intent: "buy", result, hints, rawText: raw };
  }

  // ─── [4] ROUTING ──────────────────────────────────────────────────
  const routed = decideRouting(clean, result, hints, ctx);
  if (routed) return routed;

  return { verdict: "SKIP", reason: "low_signal", intent: result.intent, result, hints, rawText: raw };
}
