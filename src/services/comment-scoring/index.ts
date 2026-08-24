// ponytail: comment-scoring — module nội bộ gộp toàn bộ flow tính score + phân loại intent
// từ 1 comment TikTok live.
//
// scoreCommentText(text)   — làm ĐÚNG 1 việc: chấm điểm + phân loại intent cho 1 đoạn text
//                             thuần, input chỉ có text, không biết gì về host/preset shop.
//                             Pure, không đụng DB → chỗ khác cần "chấm 1 câu" có thể gọi thẳng.
// scoreCommentForShop(...) — bản đầy đủ cho ingest pipeline: tự check isHost, tự match preset
//                             theo shop qua DB. isHost/matchedPresetCode được xử lý Ở NGOÀI
//                             scoreCommentText — nếu isHost hoặc có matchedPresetCode thì đi
//                             thẳng qua engine runCommentPipeline() với context đó, KHÔNG gọi
//                             scoreCommentText.
//
// Output của cả 2 hàm là ScoreCommentResult — bản RÚT GỌN, chỉ giữ field caller thực sự dùng
// (đối chiếu theo đúng những gì live-comments.service.ts đọc ra để lưu DB). Bỏ các field không
// ai dùng tới ở tầng này: hints (entity hints), rawText (text đã normalize), reason (lý do SKIP
// chi tiết), parsedData/suggestedReply (2 field này chỉ buying-intent-queue cần, và nó gọi thẳng
// analyzeLiveCommentIntent() riêng, không qua đây). Cần dữ liệu đầy đủ hơn thì dùng thẳng
// runCommentPipeline()/analyzeLiveCommentIntent() (vẫn re-export bên dưới).

import { matchPresetByComment } from "../product-presets.service.js";
import { runCommentPipeline, type PipelineResult } from "./comment-pipeline.js";
import type { CommentIntent, CommentTopic, PriorityLevel } from "./comment-intent.js";

// Ngưỡng điểm dùng chung cho toàn bộ flow auto-tạo đơn / gợi ý đơn từ comment.
export const AUTO_DRAFT_MIN_SCORE = Number(process.env.LIVE_AUTO_DRAFT_MIN_SCORE ?? 90);
export const RECOMMEND_MIN_SCORE = 85;

export type ScoreCommentResult = {
  verdict: PipelineResult["verdict"];
  intent: CommentIntent;
  priorityLevel: PriorityLevel;
  finalScore: number;
  confidence: number;
  topic: CommentTopic | null;
  canCreateOrder: boolean;
  canSuggestOrder: boolean;
  canCreateDraftOrder: boolean;
  isPotentialBuyer: boolean;
  isQuestion: boolean;
  matchedReasons: string[];
  productReference: string | null;
  matchedPresetCode: string | null;
  // chỉ có giá trị khi verdict === "NEED_LLM", còn lại luôn []
  missingFields: string[];
};

function toScoreCommentResult(pipeline: PipelineResult, matchedPresetCode: string | null): ScoreCommentResult {
  const { result } = pipeline;
  return {
    verdict: pipeline.verdict,
    intent: pipeline.intent as CommentIntent,
    priorityLevel: result.priorityLevel,
    finalScore: result.finalScore,
    confidence: result.confidence,
    topic: result.topic ?? null,
    canCreateOrder: result.canCreateOrder,
    canSuggestOrder: result.canSuggestOrder,
    canCreateDraftOrder: result.canCreateDraftOrder,
    isPotentialBuyer: result.isPotentialBuyer,
    isQuestion: result.isQuestion,
    matchedReasons: result.matchedReasons,
    productReference: result.productReference ?? null,
    matchedPresetCode,
    missingFields: pipeline.verdict === "NEED_LLM" ? pipeline.missingFields : [],
  };
}

/**
 * Chấm điểm + phân loại intent cho 1 đoạn text — pure, chỉ nhận text.
 * Không biết gì về "có phải host không" hay "có match preset không".
 */
export function scoreCommentText(commentText: string): ScoreCommentResult {
  const pipeline = runCommentPipeline(commentText, { isHost: false, matchedPresetCode: null });
  return toScoreCommentResult(pipeline, null);
}

/**
 * Chấm điểm cho 1 comment thuộc 1 shop cụ thể — bản đầy đủ dùng cho ingest pipeline thật.
 *
 * isHost và matchedPresetCode được check Ở NGOÀI scoreCommentText:
 *  - isHost=true  → trả thẳng kết quả "user/skip", không match preset (đỡ 1 query DB), không
 *                    gọi scoreCommentText.
 *  - có matchedPresetCode → đi thẳng qua runCommentPipeline() với preset code đó, cũng không
 *                    gọi scoreCommentText.
 *  - còn lại → dùng thẳng scoreCommentText().
 */
export async function scoreCommentForShop(
  shopId: string,
  commentText: string,
  opts: { isHost?: boolean } = {},
): Promise<ScoreCommentResult> {
  if (opts.isHost) {
    const pipeline = runCommentPipeline(commentText, { isHost: true, matchedPresetCode: null });
    return toScoreCommentResult(pipeline, null);
  }

  const matchedPreset = await matchPresetByComment(shopId, commentText);
  if (!matchedPreset) {
    return scoreCommentText(commentText);
  }

  const pipeline = runCommentPipeline(commentText, { isHost: false, matchedPresetCode: matchedPreset.code });
  return toScoreCommentResult(pipeline, matchedPreset.code);
}

// ── re-exports — giữ nguyên các hàm/type thuần (pure) mà nơi khác vẫn cần dùng trực tiếp,
// hoặc khi cần dữ liệu đầy đủ hơn ScoreCommentResult (parsedData, hints, rawText...) ──
export { analyzeLiveCommentIntent, buildSuggestedReply } from "./comment-intent.js";
export type {
  CommentIntent,
  CommentTopic,
  PriorityLevel,
  ParsedCommentData,
  CommentRuleResult,
  CommentIntentResult,
} from "./comment-intent.js";
export { runCommentPipeline } from "./comment-pipeline.js";
export type { PipelineVerdict, PipelineContext, PipelineResult } from "./comment-pipeline.js";
export { normalizeComment, removeVietnameseAccents, stripMetadataNoise, META_NOISE_PATTERNS } from "./comment-normalize.js";
export { extractEntityHints, hasNegation, extractProductReference } from "./comment-extract.js";
export type { EntityHints } from "./comment-extract.js";
