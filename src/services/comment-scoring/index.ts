// ponytail: comment-scoring — public API của module chấm điểm + phân loại intent comment live.
//
//   comment-types.ts     — type dùng chung (không logic)
//   comment-config.ts    — MỌI con số: base score, bonus, ngưỡng priority/routing/auto-order
//   comment-normalize.ts — decode emoji, strip badge/@handle, bỏ dấu
//   comment-keywords.ts  — từ khoá theo nhóm
//   comment-extract.ts   — regex trích entity (mã, màu, size, số lượng), topic
//   comment-filter.ts    — [1] lọc sticker/system event/noise/host
//   comment-classify.ts  — [4a] keyword → intent + baseScore (bảng INTENT_SIGNALS)
//   comment-intent.ts    — [4b] bonus → finalScore, priority, flags; entry analyzeLiveCommentIntent
//   comment-routing.ts   — [6] policy SKIP / RULE_RESOLVED / NEED_LLM
//   comment-pipeline.ts  — compose [1]→[6], sync, pure (runCommentPipeline)
//   comment-llm.ts       — [7] hook LLM cho NEED_LLM, có timeout + fallback về rule
//
// Hai entry chính:
//   scoreCommentText(text)          — sync, chỉ text, không DB, không LLM. Dùng cho endpoint
//                                     internal /score và mọi chỗ "chấm 1 câu".
//   scoreCommentForShop(shopId,...) — async, bản đầy đủ cho ingest: check host, match preset
//                                     theo catalog shop (DB), rồi qua LLM stage nếu NEED_LLM và
//                                     đã configureCommentScoring({ llmResolver }).
//
// Cắm LLM: ở bootstrap (server.ts) gọi
//   configureCommentScoring({ llmResolver: myResolver })
// với myResolver implement LlmIntentResolver (xem comment-llm.ts). Không cấu hình → hành vi
// rule-only y như cũ.

import { getProductPresetByCode, matchPresetByComment } from "../product-presets.service.js";
import { runCommentPipeline } from "./comment-pipeline.js";
import { resolveWithLlm } from "./comment-llm.js";
import { defaultRoutingPolicy, type RoutingPolicy } from "./comment-routing.js";
import { referencesPinnedItem } from "./comment-extract.js";
import { finalizeIntentResult } from "./comment-intent.js";
import { ROUTING } from "./comment-config.js";
import type {
  CommentIntent,
  CommentTopic,
  LlmIntentResolver,
  PipelineResult,
  PipelineVerdict,
  PriorityLevel,
  ResolvedBy,
  ResolvedPipelineResult,
} from "./comment-types.js";

export { AUTO_DRAFT_MIN_SCORE, RECOMMEND_MIN_SCORE, RULE_VERSION } from "./comment-config.js";

// ponytail: comment "buy" mơ hồ (không có mã/tên SP — verdict NEED_LLM) nhưng nhắc kiểu "như
// video/cái này" (referencesPinnedItem) → nếu phiên live đang ghim 1 sản phẩm (pinnedPresetCode,
// set qua PATCH /api/live-sessions/:id/pinned-product), suy ra luôn sản phẩm đó — KHÔNG cần LLM.
// Chạy TRƯỚC bước LLM (rẻ hơn, và nên ưu tiên rule nếu đã đủ chắc). Trả null nếu không áp dụng
// (giữ nguyên verdict NEED_LLM để rơi xuống LLM stage/giữ nguyên rule như cũ).
async function resolvePinnedProductReference(
  pipeline: PipelineResult,
  opts: { shopId: string; pinnedPresetCode?: string | null },
): Promise<ResolvedPipelineResult | null> {
  if (pipeline.verdict !== "NEED_LLM") return null;
  if (!opts.pinnedPresetCode) return null;
  if (!referencesPinnedItem(pipeline.cleanText)) return null;

  const preset = await getProductPresetByCode(opts.shopId, opts.pinnedPresetCode);
  if (!preset) return null;

  const rule = pipeline.result;
  const result = finalizeIntentResult({
    intent: "buy",
    finalScore: Math.max(rule.finalScore, ROUTING.presetOverrideScore),
    topic: rule.topic,
    isQuestion: false,
    matchedReasons: [...rule.matchedReasons, `Sản phẩm đang ghim: ${preset.code}`],
    productReference: preset.code,
    parsedData: {
      productCode: preset.code,
      color: rule.parsedData?.color ?? preset.color ?? null,
      size: rule.parsedData?.size ?? null,
      quantity: rule.parsedData?.quantity ?? null,
    },
  });

  return {
    verdict: "RULE_RESOLVED",
    intent: "buy",
    result,
    hints: { ...pipeline.hints, productCode: preset.code },
    rawText: pipeline.rawText,
    cleanText: pipeline.cleanText,
    context: pipeline.context,
    resolvedBy: "rule_pinned",
  };
}

// ── module config (set 1 lần ở bootstrap) ────────────────────────────────────────────────
export type CommentScoringConfig = {
  llmResolver: LlmIntentResolver | null;
  llmTimeoutMs?: number;
  routingPolicy: RoutingPolicy;
};

const config: CommentScoringConfig = {
  llmResolver: null,
  routingPolicy: defaultRoutingPolicy,
};

export function configureCommentScoring(patch: Partial<CommentScoringConfig>): CommentScoringConfig {
  Object.assign(config, patch);
  return { ...config };
}

export function getCommentScoringConfig(): Readonly<CommentScoringConfig> {
  return config;
}

// ── output rút gọn — đúng những field live-comments.service ghi DB ───────────────────────
export type ScoreCommentResult = {
  verdict: PipelineVerdict;
  /** rule | llm | rule_fallback (LLM lỗi/timeout) */
  resolvedBy: ResolvedBy;
  intent: CommentIntent;
  priorityLevel: PriorityLevel;
  finalScore: number;
  topic: CommentTopic | null;
  canCreateOrder: boolean;
  canSuggestOrder: boolean;
  canCreateDraftOrder: boolean;
  isPotentialBuyer: boolean;
  isQuestion: boolean;
  matchedReasons: string[];
  productReference: string | null;
  matchedPresetCode: string | null;
  /** chỉ có giá trị khi verdict === "NEED_LLM", còn lại luôn [] */
  missingFields: string[];
  /** lỗi LLM nếu có (để log), không throw */
  llmError?: string;
};

function toScoreCommentResult(pipeline: PipelineResult | ResolvedPipelineResult, matchedPresetCode: string | null): ScoreCommentResult {
  const { result } = pipeline;
  const resolved = "resolvedBy" in pipeline ? pipeline : null;
  return {
    verdict: pipeline.verdict,
    resolvedBy: resolved?.resolvedBy ?? "rule",
    intent: pipeline.intent,
    priorityLevel: result.priorityLevel,
    finalScore: result.finalScore,
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
    ...(resolved?.llmError ? { llmError: resolved.llmError } : {}),
  };
}

// ── entries ──────────────────────────────────────────────────────────────────────────────

/**
 * Chấm điểm + phân loại intent cho 1 đoạn text — sync, pure, rule-only.
 */
export function scoreCommentText(commentText: string): ScoreCommentResult {
  const pipeline = runCommentPipeline(commentText, { isHost: false, matchedPresetCode: null }, { routingPolicy: config.routingPolicy });
  return toScoreCommentResult(pipeline, null);
}

/**
 * Chấm điểm cho 1 comment thuộc 1 shop cụ thể — bản đầy đủ cho ingest pipeline.
 *
 *  - isHost=true           → SKIP host_comment, không query preset, không LLM.
 *  - match preset (DB)     → RULE_RESOLVED buy/high (đường "chắc chắn"), không LLM.
 *  - còn lại               → rule pipeline; nếu NEED_LLM và có resolver → LLM stage.
 */
export async function scoreCommentForShop(
  shopId: string,
  commentText: string,
  opts: { isHost?: boolean; llmResolver?: LlmIntentResolver | null; pinnedPresetCode?: string | null } = {},
): Promise<ScoreCommentResult> {
  if (opts.isHost) {
    const pipeline = runCommentPipeline(commentText, { isHost: true, matchedPresetCode: null }, { routingPolicy: config.routingPolicy });
    return toScoreCommentResult(pipeline, null);
  }

  const matchedPreset = await matchPresetByComment(shopId, commentText);
  let matchedPresetCode = matchedPreset?.code ?? null;
  const pipeline = runCommentPipeline(commentText, { isHost: false, matchedPresetCode }, { routingPolicy: config.routingPolicy });

  // ponytail: thử suy ra từ "sản phẩm đang ghim" TRƯỚC khi gọi LLM — rẻ hơn, và nếu đã đủ chắc
  // (comment nhắc kiểu "như video/cái này") thì khỏi cần LLM nữa.
  const pinnedResolved = await resolvePinnedProductReference(pipeline, { shopId, pinnedPresetCode: opts.pinnedPresetCode ?? null });
  if (pinnedResolved) {
    matchedPresetCode = pinnedResolved.result.parsedData?.productCode ?? opts.pinnedPresetCode ?? matchedPresetCode;
    return toScoreCommentResult(pinnedResolved, matchedPresetCode);
  }

  const resolver = opts.llmResolver === undefined ? config.llmResolver : opts.llmResolver;
  const resolved = await resolveWithLlm(pipeline, { resolver, timeoutMs: config.llmTimeoutMs, shopId });
  return toScoreCommentResult(resolved, matchedPresetCode);
}

// ── re-exports — hàm/type thuần cho nơi cần dữ liệu đầy đủ hơn ScoreCommentResult ────────
export { analyzeLiveCommentIntent, buildSuggestedReply } from "./comment-intent.js";
export { runCommentPipeline } from "./comment-pipeline.js";
export { resolveWithLlm, mergeLlmOutput, createStaticLlmResolver } from "./comment-llm.js";
export { decideRouting, defaultRoutingPolicy, ruleOnlyRoutingPolicy } from "./comment-routing.js";
export { classifyIntent, INTENT_SIGNALS } from "./comment-classify.js";
export { normalizeComment, removeVietnameseAccents, stripMetadataNoise, META_NOISE_PATTERNS } from "./comment-normalize.js";
export { extractEntityHints, hasNegation, extractProductReference } from "./comment-extract.js";
export type {
  CommentIntent,
  CommentTopic,
  PriorityLevel,
  ParsedCommentData,
  CommentRuleResult,
  CommentIntentResult,
  EntityHints,
  PipelineVerdict,
  PipelineContext,
  PipelineResult,
  ResolvedPipelineResult,
  ResolvedBy,
  LlmIntentResolver,
  LlmResolveInput,
  LlmResolveOutput,
} from "./comment-types.js";
export type { RoutingPolicy } from "./comment-routing.js";
