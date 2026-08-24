// ponytail: stage ROUTE — quyết định 1 comment đã chấm xong đi đâu:
//   SKIP           → không làm gì (chat vu vơ, phủ định)
//   RULE_RESOLVED  → rule đủ chắc, dùng luôn
//   NEED_LLM       → rule không chắc, để LLM stage xử lý (nếu có resolver; không có thì
//                    fallback dùng kết quả rule — xem comment-llm.ts)
//
// Policy tách ra object để có thể đổi cách route mà không sửa pipeline (vd: bật thêm band
// "score 25–60 mơ hồ → NEED_LLM" khi LLM đã rẻ/ổn định).
//
// LƯU Ý: verdict KHÔNG phải cổng an toàn cuối cho việc tự tạo đơn — tiktok-collector vẫn yêu cầu
// matchedProductCode khớp thật với catalog shop trước khi tạo đơn.

import type { CommentIntentResult, EntityHints, PipelineContext, SkipReason } from "./comment-types.js";
import { ROUTING } from "./comment-config.js";
import { hasNegation } from "./comment-extract.js";

export type RoutingDecision =
  | { verdict: "SKIP"; reason: SkipReason }
  | { verdict: "RULE_RESOLVED" }
  | { verdict: "NEED_LLM"; missingFields: string[] };

export type RoutingInput = {
  clean: string;
  result: CommentIntentResult;
  hints: EntityHints;
  ctx: PipelineContext;
};

export type RoutingPolicy = {
  name: string;
  /** dưới ngưỡng này → SKIP low_score */
  casualChatScore: number;
  /**
   * Trả về danh sách field còn thiếu nếu muốn đẩy sang LLM, `null` nếu rule tự giải quyết.
   * Chỉ được gọi khi comment đã qua ngưỡng casual + guard phủ định.
   */
  llmGate: (input: RoutingInput) => string[] | null;
};

const BUY_REASON_RE = /mua|lấy|chốt/;

function isNegatedBuy(input: RoutingInput): boolean {
  return hasNegation(input.clean) && input.result.matchedReasons.some((r) => BUY_REASON_RE.test(r));
}

/**
 * Policy mặc định: "buy" mà chưa biết mua sản phẩm nào (không có mã, không khớp preset)
 * → NEED_LLM. Các intent khác rule tự giải quyết.
 */
export const defaultRoutingPolicy: RoutingPolicy = {
  name: "buy-missing-product",
  casualChatScore: ROUTING.casualChatScore,
  llmGate: ({ result, ctx }) => {
    if (result.intent !== "buy") return null;
    if (result.productReference || ctx.matchedPresetCode) return null;
    const missing = result.missingFields?.length ? result.missingFields : ["product"];
    return missing;
  },
};

/** Policy "rule only" — không bao giờ NEED_LLM (bản đơn giản hoá cũ). */
export const ruleOnlyRoutingPolicy: RoutingPolicy = {
  name: "rule-only",
  casualChatScore: ROUTING.casualChatScore,
  llmGate: () => null,
};

export function decideRouting(input: RoutingInput, policy: RoutingPolicy = defaultRoutingPolicy): RoutingDecision {
  if (input.result.finalScore < policy.casualChatScore) return { verdict: "SKIP", reason: "low_score" };

  // guard phủ định — "không lấy S03 đâu" mà RULE_RESOLVED thành buy là lỗi nghiêm trọng
  // (có thể tự tạo đơn cho thứ khách từ chối). Giữ ở mọi policy.
  if (isNegatedBuy(input)) return { verdict: "SKIP", reason: "negated" };

  const missingFields = policy.llmGate(input);
  if (missingFields) return { verdict: "NEED_LLM", missingFields };

  return { verdict: "RULE_RESOLVED" };
}
