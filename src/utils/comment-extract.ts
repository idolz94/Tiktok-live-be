import { normalizeComment } from "./comment-normalize.js";
import { topicKeywords } from "./comment-keywords.js";
import type { CommentIntent, CommentTopic, ParsedCommentData } from "./comment-intent.js";

export function escapeRegExp(input: string) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function hasKeyword(text: string, keyword: string) {
  const normalizedKeyword = normalizeComment(keyword);
  if (normalizedKeyword.length <= 2) {
    return new RegExp(`(^|\\s)${escapeRegExp(normalizedKeyword)}($|\\s)`).test(text);
  }
  return text.includes(normalizedKeyword);
}

export function includesAny(text: string, keywords: string[]) {
  return keywords.some((keyword) => hasKeyword(text, keyword));
}

export function matchKeywords(text: string, keywords: string[]) {
  return keywords.filter((keyword) => hasKeyword(text, keyword));
}

const PRODUCT_REFERENCE_PATTERNS = [
  /(?:sp|mã|ma|mã sản phẩm|ma san pham|product)\s*#?\s*([a-z0-9]+)/i,
  /(?:vị trí|vi tri|mục|muc|hàng|hang)\s*#?\s*(\d+)/i,
  /\b(stt|số thứ tự|so thu tu)\s*#?\s*(\d+)/i,
  /\b([a-z])\s*[-–]\s*(\d{1,3})\b/i,
];

export function extractProductReference(text: string): string | undefined {
  for (const pattern of PRODUCT_REFERENCE_PATTERNS) {
    const match = text.match(pattern);
    if (match) return (match[2] || match[1] || "").trim();
  }
  return undefined;
}

export function detectTopic(text: string, hasStrongSignal: boolean): CommentTopic {
  const orderedTopics: CommentTopic[] = ["size_variant", "size", "material", "capacity", "weight", "fee", "delivery_time", "color"];
  for (const topic of orderedTopics) {
    const keywords = topicKeywords[topic];
    if (keywords && includesAny(text, keywords)) return topic;
  }
  if (!hasStrongSignal && text.split(/\s+/).length <= 4) return "unknown";
  return "unknown";
}

export function scoreConfidence(matchedCount: number, hasMultipleKeywords: boolean, hasProductRef: boolean, textWordCount: number): number {
  if (matchedCount === 0) return 0.3;
  let base = 0.6;
  if (hasMultipleKeywords) base = 0.85;
  if (hasProductRef) base += 0.05;
  if (textWordCount <= 3) base -= 0.15;
  return Math.min(0.95, Math.max(0.25, base));
}

const SIZE_TOKEN_PATTERN = /\b(?:size\s+|sz\s+)?(xxl|xl|l|m|s|xs)\b(?:\s*(\d{1,3}))?/i;
const SIZE_PLAIN_PATTERN = /\b(size|sz|cỡ|co)\s*[:#]?\s*([a-z0-9]{1,4})\b/i;

export function extractSize(text: string): string | null {
  const tokenMatch = text.match(SIZE_TOKEN_PATTERN);
  if (tokenMatch) {
    const size = tokenMatch[1].toUpperCase();
    return tokenMatch[2] ? `${size} ${tokenMatch[2]}` : size;
  }
  const plainMatch = text.match(SIZE_PLAIN_PATTERN);
  if (plainMatch) return plainMatch[2].toUpperCase();
  return null;
}

const COLOR_PATTERN = /\b(trắng|trang|đen|den|đỏ|do|xanh|vàng|vang|hồng|hong|be|nâu|nau|kem|tím|tim|cam|ghi|xám|xam|màu|mau)\b/gi;

export function extractColor(text: string): string | null {
  const matches = text.match(COLOR_PATTERN);
  if (!matches || matches.length === 0) return null;
  const first = matches[0].toLowerCase();
  return first.replace(/^(màu|mau)\s*/, "").trim() || first;
}

const QUANTITY_UNIT_PATTERN = /(\d{1,3})\s*(?:cái|cai|chiec|chiếc|bộ|bo|sp|san pham)/i;
const QUANTITY_VERB_PATTERN = /(?:lấy|lay|chốt|chot|mua|đặt|dat|order)\s+(\d{1,3})\b/i;

export function extractQuantity(text: string): number | null {
  const verbMatch = text.match(QUANTITY_VERB_PATTERN);
  if (verbMatch) {
    const n = parseInt(verbMatch[1], 10);
    if (n > 0 && n < 10000) return n;
  }
  const unitMatch = text.match(QUANTITY_UNIT_PATTERN);
  if (unitMatch) {
    const n = parseInt(unitMatch[1], 10);
    if (n > 0 && n < 10000) return n;
  }
  return null;
}

// ── negation guard — precision over coverage: "không lấy S03 đen đâu" must NOT be BUY
const NEGATION_PATTERNS = [
  /\bkhong\s+lay\b/i,
  /\bkhông\s+lấy\b/i,
  /\bkhong\s+mua\b/i,
  /\bkhông\s+mua\b/i,
  /\bkhong\s+lay\s+mau\b/i,
  /\bkhông\s+lấy\s+màu\b/i,
  /\bkhong\s+lay\s+size\b/i,
  /\bđừng\b/i,
  /\bdung\b/i,
  /\bthoi\s+khong\b/i,
  /\bthôi\s+không\b/i,
  /\bkhong\s+can\b/i,
  /\bkhông\s+cần\b/i,
  /\bhuy\b/i,
  /\bcancel\b/i,
];

export function hasNegation(text: string): boolean {
  const clean = text.toLowerCase();
  return NEGATION_PATTERNS.some((p) => p.test(clean));
}

// ── entity hints — extract even when NEED_LLM, for LLM to use
export type EntityHints = {
  productCode: string | null;
  color: string | null;
  size: string | null;
  quantity: number | null;
  destination: string | null;
};

const DESTINATION_PATTERN = /\b(giao|ship|gửi|gui)\s*(đến|den|toi|tới|ve|về)?\s*([a-zA-ZÀ-ỹ\s]{2,30})$/i;

export function extractDestination(text: string): string | null {
  const m = text.match(DESTINATION_PATTERN);
  return m ? m[3].trim() || m[2]?.trim() || null : null;
}

export function extractEntityHints(text: string, productReference?: string): EntityHints {
  return {
    productCode: productReference ?? null,
    color: extractColor(text),
    size: extractSize(text),
    quantity: extractQuantity(text),
    destination: extractDestination(text),
  };
}

export function parseCommentData(text: string, productReference?: string): ParsedCommentData {
  const hints = extractEntityHints(text, productReference);
  return {
    productCode: hints.productCode,
    color: hints.color,
    size: hints.size,
    quantity: hints.quantity,
  };
}

export function computeMissingFields(parsed: ParsedCommentData, intent: CommentIntent): string[] {
  if (intent !== "buy") return [];
  const missing: string[] = [];
  if (!parsed.productCode) missing.push("product");
  if (!parsed.quantity) missing.push("quantity");
  return missing;
}
