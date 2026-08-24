// ponytail: comment-scoring/types — toàn bộ type dùng chung của module gom về 1 chỗ để các
// stage (filter → normalize → classify → score → route → llm) chỉ import type, không import
// lẫn nhau theo vòng. File này KHÔNG chứa logic.

export type CommentIntent =
  | "buy"
  | "already_ordered"
  | "ask_price"
  | "ask_stock"
  | "ask_shipping"
  | "ask_product"
  | "ask_product_demo"
  | "ask_how_to_buy"
  // khách đang lưỡng lự/so sánh giữa 2+ lựa chọn (vd "phân vân màu xanh với nâu") — tín hiệu
  // mua mạnh, tách riêng khỏi ask_product để seller lọc ra chủ động tư vấn chốt đơn.
  | "undecided"
  | "normal"
  | "spam"
  | "user";

export type CommentTopic =
  | "size"
  | "color"
  | "material"
  | "weight"
  | "capacity"
  | "fee"
  | "delivery_time"
  | "size_variant"
  | "unknown";

export type PriorityLevel = "high" | "medium" | "low" | "normal";

export type ParsedCommentData = {
  productCode: string | null;
  color: string | null;
  size: string | null;
  quantity: number | null;
};

// entity hints — trích ra TRƯỚC routing, luôn có mặt (kể cả SKIP/NEED_LLM) để LLM dùng làm gợi ý.
export type EntityHints = ParsedCommentData & {
  destination: string | null;
};

// ── Kết quả rule engine cho 1 comment (pure, chỉ phụ thuộc text) ─────────────────────────
export type CommentRuleResult = {
  intent: CommentIntent;
  topic?: CommentTopic;
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
  // legacy alias của canCreateDraftOrder — giữ để Mobile/Web cũ không vỡ
  canCreateOrder: boolean;
};

// ── Phân loại intent (stage classify) — trước khi cộng điểm ─────────────────────────────
export type IntentClassification = {
  intent: CommentIntent;
  baseScore: number;
  matchedReasons: string[];
  /** có match nhóm productKeywords (mạnh) — dùng cho bonus +5 khi không có mã */
  hasProductKeyword: boolean;
  /** có match nhóm weakProductKeywords — tránh double-count bonus màu/size */
  hasWeakProductKeyword: boolean;
  /** có keyword "phân vân" — được coi như 1 dạng câu hỏi */
  hasUndecidedKeyword: boolean;
};

// ── Pipeline ────────────────────────────────────────────────────────────────────────────
export type PipelineVerdict = "SKIP" | "RULE_RESOLVED" | "NEED_LLM" | "LLM_RESOLVED";

export type SkipReason =
  | "sticker_or_emoji_only"
  | "empty_or_too_short"
  | "system_event"
  | "noise_only"
  | "host_comment"
  | "spam_detected"
  | "low_score"
  | "negated"
  | "low_signal";

export type PipelineContext = {
  isHost: boolean;
  matchedPresetCode?: string | null;
};

type PipelineBase = {
  intent: CommentIntent;
  result: CommentIntentResult;
  hints: EntityHints;
  /** text gốc như khách gõ */
  rawText: string;
  /** text sau normalize (bỏ dấu, lowercase, strip badge/@handle) — "" nếu SKIP trước normalize */
  cleanText: string;
  context: PipelineContext;
};

export type PipelineResult =
  | (PipelineBase & { verdict: "SKIP"; reason: SkipReason })
  | (PipelineBase & { verdict: "RULE_RESOLVED" })
  | (PipelineBase & { verdict: "NEED_LLM"; missingFields: string[] })
  | (PipelineBase & { verdict: "LLM_RESOLVED"; resolver: string });

// ── LLM hook ────────────────────────────────────────────────────────────────────────────
// Rule engine chạy trước, chỉ những comment rơi vào NEED_LLM mới gọi resolver. Resolver
// KHÔNG được quyết định tạo đơn — chỉ được sửa intent/score/entities; cổng an toàn tạo đơn
// (khớp preset thật của shop) vẫn nằm ở tiktok-collector.
export type LlmResolveInput = {
  rawText: string;
  cleanText: string;
  ruleResult: CommentIntentResult;
  hints: EntityHints;
  missingFields: string[];
  context: {
    shopId?: string | null;
    matchedPresetCode?: string | null;
  };
};

export type LlmResolveOutput = {
  intent?: CommentIntent;
  /** 0–100, sẽ bị clamp */
  finalScore?: number;
  parsedData?: Partial<ParsedCommentData>;
  /** lý do LLM đưa ra — được nối vào matchedReasons với prefix "LLM:" */
  reasons?: string[];
  suggestedReply?: string;
};

export interface LlmIntentResolver {
  /** tên hiển thị/log, vd "openai:gpt-4o-mini" */
  readonly name: string;
  resolve(input: LlmResolveInput, opts: { signal: AbortSignal }): Promise<LlmResolveOutput | null>;
}

export type ResolvedBy = "rule" | "llm" | "rule_fallback";

export type ResolvedPipelineResult = PipelineResult & {
  resolvedBy: ResolvedBy;
  /** lỗi/timeout của resolver (nếu có) — chỉ để log, không throw ra ngoài */
  llmError?: string;
};
