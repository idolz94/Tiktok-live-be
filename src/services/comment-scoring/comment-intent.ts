export type CommentIntent =
  | "buy"
  | "already_ordered"
  | "ask_price"
  | "ask_stock"
  | "ask_shipping"
  | "ask_product"
  | "ask_product_demo"
  | "ask_how_to_buy"
  // ponytail: khách đang lưỡng lự/so sánh giữa 2+ lựa chọn (vd "phân vân màu xanh với nâu") —
  // tín hiệu mua mạnh, tách riêng khỏi ask_product để seller lọc ra chủ động tư vấn chốt đơn.
  | "undecided"
  | "normal"
  | "spam"
  | "user";

export type CommentTopic = "size" | "color" | "material" | "weight" | "capacity" | "fee" | "delivery_time" | "size_variant" | "unknown";
export type PriorityLevel = "high" | "medium" | "low" | "normal";

export type ParsedCommentData = {
  productCode: string | null;
  color: string | null;
  size: string | null;
  quantity: number | null;
};

export type CommentRuleResult = {
  intent: CommentIntent;
  topic?: CommentTopic;
  confidence: number;
  priorityLevel: PriorityLevel;
  finalScore: number;
  canSuggestOrder: boolean;
  canCreateDraftOrder: boolean;
  isPotentialBuyer: boolean;
  isQuestion: boolean;
  matchedReasons: string[];
  productReference?: string;
  parsedData?: ParsedCommentData;
  missingFields?: string[];
  suggestedReply?: string;
};

export type CommentIntentResult = CommentRuleResult & {
  canCreateOrder: boolean;
};

import { normalizeComment, stripMetadataNoise } from "./comment-normalize.js";
import {
  alreadyOrderedKeywords,
  buyKeywords,
  howToBuyKeywords,
  priceKeywords,
  potentialBuyerIntents,
  productDemoKeywords,
  productKeywords,
  shippingKeywords,
  spamKeywords,
  stockKeywords,
  undecidedKeywords,
  weakProductKeywords,
} from "./comment-keywords.js";
import {
  computeMissingFields,
  detectTopic,
  extractProductReference,
  includesAny,
  matchKeywords,
  parseCommentData,
  scoreConfidence,
} from "./comment-extract.js";

export { normalizeComment } from "./comment-normalize.js";
export { removeVietnameseAccents, stripMetadataNoise, META_NOISE_PATTERNS } from "./comment-normalize.js";

function isQuestion(text: string) {
  if (text.includes("?")) return true;
  if (includesAny(text, ["không", "khong", "ko", "bao nhiêu", "bao nhieu", "mấy", "may", "thế nào", "the nao", "được không", "duoc khong", "có được", "co duoc", "nào", "nao", "hả", "ha", "nhỉ", "nhi", "ạ", "hong", "hông", "hk"])) return true;
  if (/\bk\s*[?.!]*$/i.test(text)) return true;
  if (/\b(k|ko|hk|hong|hông)\b/i.test(text)) return true;
  return false;
}

const NEGATION_RE = /(khong\s+lay|không\s+lấy|khong\s+mua|không\s+mua|khong\s+can|không\s+cần|\bđừng\b|\bthoi\s+khong|\bthôi\s+không|\bhuy\b|\bcancel\b)/i;
function isNegated(text: string) { return NEGATION_RE.test(text.toLowerCase()); }

function priorityFromScore(finalScore: number): PriorityLevel {
  if (finalScore >= 85) return "high";
  if (finalScore >= 60) return "medium";
  if (finalScore >= 35) return "low";
  return "normal";
}

function withLegacyOrderFlag(result: CommentRuleResult): CommentIntentResult {
  return { ...result, canCreateOrder: result.canCreateDraftOrder };
}

export function buildSuggestedReply(intent: CommentIntent, missingFields: string[]): string {
  if (intent === "undecided") return "Dạ shop tư vấn thêm giúp mình chọn nhé ạ!";
  if (intent !== "buy" || missingFields.length === 0) return "";
  const labels: Record<string, string> = { product: "mã sản phẩm", color: "màu", size: "size", quantity: "số lượng" };
  const parts = missingFields.map((f) => labels[f] || f).filter(Boolean);
  if (parts.length === 0) return "";
  return `Shop hỏi thêm: ${parts.join(", ")} để chốt đơn nhé ạ.`;
}

export function analyzeLiveCommentIntent(commentText: string, opts?: { shopBoost?: boolean }): CommentIntentResult {
  const cleanedText = stripMetadataNoise(String(commentText || "").trim());
  const text = normalizeComment(cleanedText);

  if (!text) {
    return withLegacyOrderFlag({
      intent: "normal",
      topic: "unknown",
      confidence: 0,
      priorityLevel: "normal",
      finalScore: 0,
      canSuggestOrder: false,
      canCreateDraftOrder: false,
      isPotentialBuyer: false,
      isQuestion: false,
      matchedReasons: [],
      parsedData: { productCode: null, color: null, size: null, quantity: null },
      missingFields: [],
      suggestedReply: "",
    });
  }

  const productReference = extractProductReference(text);
  const textWordCount = text.split(/\s+/).filter(Boolean).length;
  // ponytail: tính sớm để gộp vào "question" — câu "phân vân..." không có dấu "?" nhưng về bản
  // chất là đang cần seller trả lời/tư vấn, nên coi như 1 dạng câu hỏi.
  const undecidedMatches = matchKeywords(text, undecidedKeywords);
  const question = isQuestion(text) || undecidedMatches.length > 0;

  const spamMatches = matchKeywords(text, spamKeywords);
  if (spamMatches.length > 0) {
    return withLegacyOrderFlag({
      intent: "spam",
      topic: "unknown",
      confidence: 0.95,
      priorityLevel: "normal",
      finalScore: 0,
      canSuggestOrder: false,
      canCreateDraftOrder: false,
      isPotentialBuyer: false,
      isQuestion: question,
      matchedReasons: spamMatches.map((item) => `Spam: ${item}`),
      parsedData: { productCode: null, color: null, size: null, quantity: null },
      missingFields: [],
      suggestedReply: "",
    });
  }

  const buyMatches = matchKeywords(text, buyKeywords);
  const alreadyOrderedMatches = matchKeywords(text, alreadyOrderedKeywords);
  const productDemoMatches = matchKeywords(text, productDemoKeywords);
  const priceMatches = matchKeywords(text, priceKeywords);
  const stockMatches = matchKeywords(text, stockKeywords);
  const shippingMatches = matchKeywords(text, shippingKeywords);
  const productMatches = matchKeywords(text, productKeywords);
  const weakProductMatches = matchKeywords(text, weakProductKeywords);
  const howToBuyMatches = matchKeywords(text, howToBuyKeywords);
  // ponytail: "mẫu" trùng "màu" sau khi bỏ dấu — nhưng "mẫu <số>" (hỏi mẫu sản phẩm, vd
  // "mẫu 3") mang nghĩa hoàn toàn khác "màu đen" (hỏi màu sắc). weakProductKeywords chỉ bắt
  // được "mau" như tín hiệu màu yếu, nên bù thêm 1 tín hiệu riêng cho case "mau" + số.
  const hasModelNumberRef = /\bmau\s*#?\s*\d{1,4}\b/.test(text);
  const matchedReasons: string[] = [];

  for (const item of buyMatches) matchedReasons.push(`Có ý định mua: ${item}`);
  for (const item of alreadyOrderedMatches) matchedReasons.push(`Đã đặt/mua rồi: ${item}`);
  for (const item of productDemoMatches) matchedReasons.push(`Yêu cầu demo sản phẩm: ${item}`);
  for (const item of priceMatches) matchedReasons.push(`Hỏi giá/voucher: ${item}`);
  for (const item of stockMatches) matchedReasons.push(`Hỏi tồn kho: ${item}`);
  for (const item of shippingMatches) matchedReasons.push(`Hỏi vận chuyển: ${item}`);
  for (const item of productMatches) matchedReasons.push(`Hỏi sản phẩm: ${item}`);
  for (const item of weakProductMatches) matchedReasons.push(`Tín hiệu sản phẩm yếu: ${item}`);
  if (hasModelNumberRef) matchedReasons.push("Hỏi sản phẩm: mẫu (số)");
  for (const item of undecidedMatches) matchedReasons.push(`Đang phân vân: ${item}`);
  for (const item of howToBuyMatches) matchedReasons.push(`Hỏi cách mua: ${item}`);

  let intent: CommentIntent = "normal";
  let baseScore = 0;

  if (alreadyOrderedMatches.length > 0) {
    intent = "already_ordered";
    baseScore = 80;
  } else if (buyMatches.length > 0) {
    intent = "buy";
    baseScore = 90;
  } else if (productDemoMatches.length > 0) {
    intent = "ask_product_demo";
    baseScore = 88;
  } else if (howToBuyMatches.length > 0) {
    intent = "ask_how_to_buy";
    baseScore = 85;
  } else if (undecidedMatches.length > 0) {
    intent = "undecided";
    baseScore = 75;
  } else if (priceMatches.length > 0) {
    intent = "ask_price";
    baseScore = 75;
  } else if (stockMatches.length > 0) {
    intent = "ask_stock";
    baseScore = 70;
  } else if (shippingMatches.length > 0) {
    intent = "ask_shipping";
    baseScore = 65;
  } else if (productMatches.length > 0 || hasModelNumberRef) {
    intent = "ask_product";
    baseScore = 60;
  } else if (weakProductMatches.length > 0) {
    intent = "ask_product";
    baseScore = 30;
  }

  // ponytail: parse before scoring so bonuses can use entities; keep it cheap
  const earlyParsed = parseCommentData(text, productReference);
  let bonus = 0;
  // question: +25 keeps normal question above casual threshold, otherwise +5
  if (question) bonus += intent === "normal" ? 25 : 5;
  if (productReference) bonus += 10;
  else if (productMatches.length > 0) bonus += 5;
  // ponytail: color/size entity +5, but not double-count weak (weak already is color/size)
  if ((earlyParsed.color || earlyParsed.size) && weakProductMatches.length === 0) bonus += 5;
  if (earlyParsed.quantity) bonus += 5;
  if (isNegated(text)) bonus -= 20;
  if (opts?.shopBoost) bonus += 25;
  let finalScore = Math.max(0, Math.min(100, baseScore + bonus));

  const hasStrongSignal = finalScore >= 60;
  const topic = detectTopic(text, hasStrongSignal);
  const totalMatched =
    buyMatches.length +
    alreadyOrderedMatches.length +
    productDemoMatches.length +
    priceMatches.length +
    stockMatches.length +
    shippingMatches.length +
    productMatches.length +
    weakProductMatches.length +
    howToBuyMatches.length;
  const confidence = scoreConfidence(totalMatched, totalMatched >= 2, Boolean(productReference), textWordCount);

  if (question && intent === "normal") {
    matchedReasons.push("Có dấu hiệu là câu hỏi của khách");
  }

  if (matchedReasons.length === 0) {
    return withLegacyOrderFlag({
      intent: "normal",
      topic,
      confidence,
      priorityLevel: "normal",
      finalScore: 0,
      canSuggestOrder: false,
      canCreateDraftOrder: false,
      isPotentialBuyer: false,
      isQuestion: question,
      matchedReasons: [],
      productReference,
      parsedData: { productCode: null, color: null, size: null, quantity: null },
      missingFields: [],
      suggestedReply: "",
    });
  }

  const parsedData = parseCommentData(text, productReference);
  const missingFields = computeMissingFields(parsedData, intent);
  const suggestedReply = buildSuggestedReply(intent, missingFields);

  return withLegacyOrderFlag({
    intent,
    topic,
    confidence,
    priorityLevel: priorityFromScore(finalScore),
    finalScore,
    canSuggestOrder: intent === "buy",
    canCreateDraftOrder: intent === "buy" && Boolean(productReference),
    isPotentialBuyer: (potentialBuyerIntents as readonly string[]).includes(intent),
    isQuestion: question,
    matchedReasons,
    productReference,
    parsedData,
    missingFields,
    suggestedReply,
  });
}
