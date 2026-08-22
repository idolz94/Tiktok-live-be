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
const HIGH_CONFIDENCE_THRESHOLD = 0.85;
const BUY_SCORE_THRESHOLD = 85;
const LOW_CONFIDENCE_THRESHOLD = 0.6;
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

// ── [3] RULE ENGINE — precision-first: only RULE_RESOLVED when truly certain

function hasStrictBuySignal(clean: string, result: CommentIntentResult): boolean {
  // ponytail: negation guard — "không lấy S03 đen đâu" must never be BUY
  if (hasNegation(clean)) return false;
  if (result.intent !== "buy") return false;
  if (!result.productReference) return false;
  if (result.finalScore < BUY_SCORE_THRESHOLD) return false;
  if (result.confidence < HIGH_CONFIDENCE_THRESHOLD) return false;
  return true;
}

function decideRouting(
  clean: string,
  result: CommentIntentResult,
  hints: EntityHints,
  ctx: PipelineContext,
): PipelineResult | null {
  // casual chat → SKIP (no LLM cost)
  if (result.intent === "normal" && result.finalScore < CASUAL_CHAT_SCORE) {
    return { verdict: "SKIP", reason: "casual_chat", intent: "normal", result, hints, rawText: clean };
  }
  // ponytail: colloquial question (ko/hk/hong, "mấy giờ?") rescued to LLM, not dropped
  if (result.isQuestion && result.intent === "normal") {
    return { verdict: "NEED_LLM", intent: "ask_product", result, hints, rawText: clean, missingFields: [] };
  }

  // buy with strict signal → RULE_RESOLVED (precision > coverage)
  if (hasStrictBuySignal(clean, result)) {
    return { verdict: "RULE_RESOLVED", intent: "buy", result, hints, rawText: clean };
  }

  // preset matched by shop catalog → RULE_RESOLVED (shop knows this code)
  // ponytail: only if no negation — "không lấy S03" with preset S03 must not resolve
  if (ctx.matchedPresetCode && result.intent !== "user" && !hasNegation(clean)) {
    return { verdict: "RULE_RESOLVED", intent: "buy", result, hints, rawText: clean };
  }

  // buy but missing product or fields → NEED_LLM (don't guess)
  if (result.intent === "buy") {
    return { verdict: "NEED_LLM", intent: "buy", result, hints, rawText: clean, missingFields: result.missingFields || ["product"] };
  }

  // negation on any buy-like text → NEED_LLM (let LLM disambiguate, never SKIP)
  if (hasNegation(clean) && result.matchedReasons.some((r) => r.includes("mua") || r.includes("lấy") || r.includes("chốt"))) {
    return { verdict: "NEED_LLM", intent: result.intent, result, hints, rawText: clean, missingFields: [] };
  }

  // low-confidence questions → NEED_LLM
  if (
    (result.intent === "ask_price" ||
      result.intent === "ask_stock" ||
      result.intent === "ask_shipping" ||
      result.intent === "ask_product") &&
    result.confidence < LOW_CONFIDENCE_THRESHOLD
  ) {
    return { verdict: "NEED_LLM", intent: result.intent, result, hints, rawText: clean, missingFields: result.missingFields || [] };
  }

  // confident non-buy intents → RULE_RESOLVED
  if (
    result.intent === "ask_price" ||
    result.intent === "ask_stock" ||
    result.intent === "ask_shipping" ||
    result.intent === "ask_product" ||
    result.intent === "ask_product_demo" ||
    result.intent === "ask_how_to_buy" ||
    result.intent === "already_ordered"
  ) {
    return { verdict: "RULE_RESOLVED", intent: result.intent, result, hints, rawText: clean };
  }

  return null;
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
