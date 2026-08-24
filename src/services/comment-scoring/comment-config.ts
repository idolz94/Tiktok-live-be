// ponytail: comment-scoring/config — MỌI con số của engine nằm ở đây (base score theo intent,
// bonus, ngưỡng priority, ngưỡng routing, ngưỡng auto-order). Muốn tune điểm thì sửa file này,
// không phải lục trong logic. Giá trị giữ nguyên 100% so với bản trước refactor.

import type { CommentIntent, PriorityLevel } from "./comment-types.js";

/** Ghi vào live_comments.rule_version — tăng khi thay đổi rule làm đổi kết quả chấm. */
export const RULE_VERSION = "comment-rules-v1";

// ── Base score theo intent — thứ tự trong bảng = thứ tự ưu tiên khi 1 câu match nhiều nhóm ──
// (already_ordered thắng buy: "đặt rồi, lấy thêm 1" → already_ordered)
export const INTENT_BASE_SCORE: Record<Exclude<CommentIntent, "normal" | "spam" | "user">, number> = {
  already_ordered: 80,
  buy: 90,
  ask_product_demo: 88,
  ask_how_to_buy: 85,
  undecided: 75,
  ask_price: 75,
  ask_stock: 70,
  ask_shipping: 65,
  ask_product: 60,
};

/** ask_product khi chỉ có tín hiệu yếu (size/màu đứng 1 mình) */
export const WEAK_PRODUCT_BASE_SCORE = 30;

// ── Bonus cộng dồn lên base score ──
export const SCORE_BONUS = {
  /** câu hỏi nhưng chưa rõ intent (normal) — +25 để vượt ngưỡng casual chat */
  questionOnNormal: 25,
  /** câu hỏi đã có intent — chỉ +5 */
  questionOnIntent: 5,
  /** có mã sản phẩm (S03, mẫu 3, stt 5...) */
  productReference: 10,
  /** không có mã nhưng có keyword sản phẩm mạnh */
  productKeyword: 5,
  /** parse được màu hoặc size (không cộng nếu đã match weak keyword — tránh double count) */
  colorOrSize: 5,
  /** parse được số lượng */
  quantity: 5,
  /** có phủ định ("không lấy", "đừng", "huỷ"...) */
  negation: -20,
  /** comment khớp preset sản phẩm của shop */
  shopPresetBoost: 25,
} as const;

export const SCORE_MIN = 0;
export const SCORE_MAX = 100;

// ── Priority band từ finalScore ──
export const PRIORITY_BANDS: Array<{ min: number; level: PriorityLevel }> = [
  { min: 85, level: "high" },
  { min: 60, level: "medium" },
  { min: 35, level: "low" },
];

// ── Routing ──
export const ROUTING = {
  /** dưới ngưỡng này = chat vu vơ → SKIP, không tốn LLM */
  casualChatScore: 25,
  /** text ngắn hơn = SKIP ngay */
  minTextLength: 2,
  /** khi khớp preset shop → ép intent buy và score tối thiểu này */
  presetOverrideScore: 90,
} as const;

// ── Ngưỡng downstream (tiktok-collector) — dùng chung cho gợi ý đơn / tự tạo đơn nháp ──
export const RECOMMEND_MIN_SCORE = 85;
export const AUTO_DRAFT_MIN_SCORE = Number(process.env.LIVE_AUTO_DRAFT_MIN_SCORE ?? 90);

// ── LLM hook ──
export const LLM_RESOLVE = {
  /** resolver quá thời gian này → fallback về kết quả rule */
  timeoutMs: Number(process.env.LIVE_COMMENT_LLM_TIMEOUT_MS ?? 2500),
} as const;

export const potentialBuyerIntents: readonly CommentIntent[] = [
  "buy",
  "ask_price",
  "ask_stock",
  "ask_shipping",
  "ask_product",
  "ask_product_demo",
  "ask_how_to_buy",
  "undecided",
];
