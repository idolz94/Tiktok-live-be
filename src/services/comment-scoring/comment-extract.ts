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

// ponytail: \b bắt buộc cả trước lẫn sau từ khoá — không có \b sau thì "ma" khớp nhầm vào
// giữa 1 từ thường bất kỳ có "ma" đứng đầu (vd "mặc" → "mac" khớp "ma" + capture nhầm "c" làm
// mã sản phẩm). Có \b sau đảm bảo từ khoá phải đứng riêng biệt (theo sau là khoảng trắng/kết
// thúc chuỗi/dấu câu), không phải tiền tố của từ khác.
const PRODUCT_REFERENCE_PATTERNS = [
  /\b(?:sp|mã|ma|mã sản phẩm|ma san pham|product)\b\s*#?\s*([a-z0-9]+)/i,
  // ponytail: "mẫu" (mẫu sản phẩm) và "màu" (color) đều mất dấu thành "mau" — không phân biệt
  // được bằng chữ. Nhưng "mẫu <số>" gần như luôn nghĩa "mẫu số mấy" (hỏi sản phẩm), còn màu thì
  // không ai gọi bằng số ("màu 3" không phải cách nói màu sắc) — nên "mau" + số ngay sau coi là
  // an toàn để hiểu là mẫu sản phẩm, không phải màu.
  /\bmau\s*#?\s*(\d{1,4})\b/i,
  /\b(?:vị trí|vi tri|mục|muc|hàng|hang)\b\s*#?\s*(\d+)/i,
  /\b(stt|số thứ tự|so thu tu)\b\s*#?\s*(\d+)/i,
  /\b([a-z])\s*[-–]\s*(\d{1,3})\b/i,
];

// ponytail: các từ hay đứng ngay sau "mã/sp" trong câu nói chuyện bình thường nhưng không
// phải mã sản phẩm thật (vd "mã này" → "này" chỉ là "cái này", "mã gì vậy" → "gì" là hỏi).
// Text truyền vào đây đã qua normalizeComment (bỏ dấu, thường hoá) nên so sánh ở dạng không dấu.
// Liệt kê 1 lần cho đầy đủ theo nhóm (thay vì vá dần theo từng bug gặp phải) — vẫn là blocklist
// nên có thể sót từ hiếm, nhưng phủ được phần lớn cách nói thực tế của khách trong live.
const NON_CODE_WORDS = new Set([
  // đại từ chỉ định
  "nay", "do", "kia", "day", "ay",
  // đại từ nghi vấn
  "gi", "sao", "nao", "dau", "ai", "may",
  // trợ từ / tiểu từ tình thái hay đứng cuối câu, cũng hay bị bắt nhầm khi đứng ngay sau "mã"
  "the", "vay", "a", "nhe", "nha", "ha", "nhi", "oi", "di", "luon", "hen", "ne", "z", "v",
]);

export function extractProductReference(text: string): string | undefined {
  for (const pattern of PRODUCT_REFERENCE_PATTERNS) {
    const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
    const globalPattern = new RegExp(pattern.source, flags);
    let match: RegExpExecArray | null;
    // ponytail: match đầu tiên mà rơi vào NON_CODE_WORDS thì bỏ qua, tìm tiếp match kế trong
    // cùng chuỗi (thay vì chấp nhận luôn hoặc bỏ hẳn pattern) — phòng câu có nhắc mã thật ở chỗ khác.
    while ((match = globalPattern.exec(text)) !== null) {
      const captured = (match[2] || match[1] || "").trim();
      if (captured && !NON_CODE_WORDS.has(captured.toLowerCase())) return captured;
      if (match.index === globalPattern.lastIndex) globalPattern.lastIndex += 1;
    }
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
