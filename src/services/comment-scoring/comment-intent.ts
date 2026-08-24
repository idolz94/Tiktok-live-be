// ponytail: stage SCORE + entry `analyzeLiveCommentIntent` — rule engine thuần cho 1 đoạn text.
//
//   text → normalize → [spam?] → classifyIntent (comment-classify.ts) → applyScoreBonuses
//        → priority/topic → parse entities → CommentIntentResult
//
// File này KHÔNG biết gì về host/preset/DB/LLM. Mọi con số nằm ở comment-config.ts.

import type {
  CommentIntent,
  CommentIntentResult,
  CommentRuleResult,
  IntentClassification,
  ParsedCommentData,
  PriorityLevel,
} from "./comment-types.js";
import { PRIORITY_BANDS, SCORE_BONUS, SCORE_MAX, SCORE_MIN, potentialBuyerIntents } from "./comment-config.js";
import { normalizeComment, stripMetadataNoise } from "./comment-normalize.js";
import { classifyIntent, matchSpam } from "./comment-classify.js";
import {
  computeMissingFields,
  detectTopic,
  extractProductReference,
  includesAny,
  parseCommentData,
} from "./comment-extract.js";

// re-export để code cũ import từ đây vẫn chạy
export type { CommentIntent, CommentIntentResult, CommentRuleResult, CommentTopic, ParsedCommentData, PriorityLevel } from "./comment-types.js";
export { normalizeComment, removeVietnameseAccents, stripMetadataNoise, META_NOISE_PATTERNS } from "./comment-normalize.js";

// ── question / negation detectors ────────────────────────────────────────────────────────
const QUESTION_WORDS = [
  "không", "khong", "ko", "bao nhiêu", "bao nhieu", "mấy", "may", "thế nào", "the nao",
  "được không", "duoc khong", "có được", "co duoc", "nào", "nao", "hả", "ha", "nhỉ", "nhi",
  "ạ", "hong", "hông", "hk",
];
const QUESTION_TAIL_RE = /\bk\s*[?.!]*$/i;
const QUESTION_SHORT_NEG_RE = /\b(k|ko|hk|hong|hông)\b/i;

export function isQuestion(text: string): boolean {
  if (text.includes("?")) return true;
  if (includesAny(text, QUESTION_WORDS)) return true;
  if (QUESTION_TAIL_RE.test(text)) return true;
  if (QUESTION_SHORT_NEG_RE.test(text)) return true;
  return false;
}

const NEGATION_RE = /(khong\s+lay|không\s+lấy|khong\s+mua|không\s+mua|khong\s+can|không\s+cần|\bđừng\b|\bthoi\s+khong|\bthôi\s+không|\bhuy\b|\bcancel\b)/i;
export function isNegated(text: string): boolean {
  return NEGATION_RE.test(text.toLowerCase());
}

// ── score helpers ────────────────────────────────────────────────────────────────────────
export function priorityFromScore(finalScore: number): PriorityLevel {
  for (const band of PRIORITY_BANDS) if (finalScore >= band.min) return band.level;
  return "normal";
}

export function clampScore(score: number): number {
  return Math.max(SCORE_MIN, Math.min(SCORE_MAX, score));
}

export function isPotentialBuyerIntent(intent: CommentIntent): boolean {
  return potentialBuyerIntents.includes(intent);
}

export type ScoreBonusInput = {
  classification: IntentClassification;
  question: boolean;
  productReference: string | undefined;
  parsed: ParsedCommentData;
  negated: boolean;
  shopBoost: boolean;
};

/** Cộng bonus lên baseScore → finalScore (đã clamp 0–100). Pure. */
export function applyScoreBonuses(input: ScoreBonusInput): number {
  const { classification: c, question, productReference, parsed, negated, shopBoost } = input;
  let bonus = 0;
  if (question) bonus += c.intent === "normal" ? SCORE_BONUS.questionOnNormal : SCORE_BONUS.questionOnIntent;
  if (productReference) bonus += SCORE_BONUS.productReference;
  else if (c.hasProductKeyword) bonus += SCORE_BONUS.productKeyword;
  if ((parsed.color || parsed.size) && !c.hasWeakProductKeyword) bonus += SCORE_BONUS.colorOrSize;
  if (parsed.quantity) bonus += SCORE_BONUS.quantity;
  if (negated) bonus += SCORE_BONUS.negation;
  if (shopBoost) bonus += SCORE_BONUS.shopPresetBoost;
  return clampScore(c.baseScore + bonus);
}

export function buildSuggestedReply(intent: CommentIntent, missingFields: string[]): string {
  if (intent === "undecided") return "Dạ shop tư vấn thêm giúp mình chọn nhé ạ!";
  if (intent !== "buy" || missingFields.length === 0) return "";
  const labels: Record<string, string> = { product: "mã sản phẩm", color: "màu", size: "size", quantity: "số lượng" };
  const parts = missingFields.map((f) => labels[f] || f).filter(Boolean);
  if (parts.length === 0) return "";
  return `Shop hỏi thêm: ${parts.join(", ")} để chốt đơn nhé ạ.`;
}

// ── result builders ──────────────────────────────────────────────────────────────────────
const EMPTY_PARSED: ParsedCommentData = { productCode: null, color: null, size: null, quantity: null };

function withLegacyOrderFlag(result: CommentRuleResult): CommentIntentResult {
  return { ...result, canCreateOrder: result.canCreateDraftOrder };
}

/** Kết quả "không có gì để làm" — dùng cho text rỗng, spam, không match reason nào. */
export function emptyIntentResult(overrides: Partial<CommentRuleResult> = {}): CommentIntentResult {
  return withLegacyOrderFlag({
    intent: "normal",
    topic: "unknown",
    priorityLevel: "normal",
    finalScore: 0,
    canSuggestOrder: false,
    canCreateDraftOrder: false,
    isPotentialBuyer: false,
    isQuestion: false,
    matchedReasons: [],
    parsedData: { ...EMPTY_PARSED },
    missingFields: [],
    suggestedReply: "",
    ...overrides,
  });
}

/**
 * Dựng CommentIntentResult từ intent + score đã chốt. Tất cả các flag phái sinh
 * (priority, canSuggestOrder, canCreateDraftOrder, isPotentialBuyer, missingFields, suggestedReply)
 * được tính lại ở đây — LLM stage cũng dùng hàm này sau khi override intent/score để không
 * có chỗ thứ 2 tự suy flag.
 */
export function finalizeIntentResult(input: {
  intent: CommentIntent;
  finalScore: number;
  topic: CommentRuleResult["topic"];
  isQuestion: boolean;
  matchedReasons: string[];
  productReference: string | undefined;
  parsedData: ParsedCommentData;
}): CommentIntentResult {
  const finalScore = clampScore(input.finalScore);
  const missingFields = computeMissingFields(input.parsedData, input.intent);
  return withLegacyOrderFlag({
    intent: input.intent,
    topic: input.topic,
    priorityLevel: priorityFromScore(finalScore),
    finalScore,
    canSuggestOrder: input.intent === "buy",
    canCreateDraftOrder: input.intent === "buy" && Boolean(input.productReference),
    isPotentialBuyer: isPotentialBuyerIntent(input.intent),
    isQuestion: input.isQuestion,
    matchedReasons: input.matchedReasons,
    productReference: input.productReference,
    parsedData: input.parsedData,
    missingFields,
    suggestedReply: buildSuggestedReply(input.intent, missingFields),
  });
}

// ── entry ────────────────────────────────────────────────────────────────────────────────
export function analyzeLiveCommentIntent(commentText: string, opts?: { shopBoost?: boolean }): CommentIntentResult {
  const cleanedText = stripMetadataNoise(String(commentText || "").trim());
  const text = normalizeComment(cleanedText);
  if (!text) return emptyIntentResult();

  const classification = classifyIntent(text);
  // "phân vân..." không có dấu "?" nhưng bản chất là cần seller tư vấn → coi như câu hỏi
  const question = isQuestion(text) || classification.hasUndecidedKeyword;

  // spam short-circuit — không chấm điểm gì thêm
  const spamMatches = matchSpam(text);
  if (spamMatches.length > 0) {
    return emptyIntentResult({
      intent: "spam",
      isQuestion: question,
      matchedReasons: spamMatches.map((item) => `Spam: ${item}`),
    });
  }

  const productReference = extractProductReference(text);
  const parsed = parseCommentData(text, productReference);
  const negated = isNegated(text);

  const finalScore = applyScoreBonuses({
    classification,
    question,
    productReference,
    parsed,
    negated,
    shopBoost: Boolean(opts?.shopBoost),
  });

  const topic = detectTopic(text, finalScore >= 60);

  const matchedReasons = [...classification.matchedReasons];
  if (question && classification.intent === "normal") matchedReasons.push("Có dấu hiệu là câu hỏi của khách");

  // không có tín hiệu nào → normal/0 điểm (kể cả khi là câu hỏi — giữ hành vi cũ)
  if (matchedReasons.length === 0) {
    return emptyIntentResult({ topic, isQuestion: question, productReference });
  }

  return finalizeIntentResult({
    intent: classification.intent,
    finalScore,
    topic,
    isQuestion: question,
    matchedReasons,
    productReference,
    parsedData: parsed,
  });
}
