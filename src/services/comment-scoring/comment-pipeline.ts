// ponytail: PIPELINE — compose các stage cho 1 comment TikTok live. Sync, rule-only.
//
//   raw ─▶ [1] FILTER (sticker/emoji)
//       ─▶ [2] NORMALIZE (decode emoji, strip badge/@handle, bỏ dấu, lowercase)
//       ─▶ [1'] FILTER (rỗng / system event / noise / host)
//       ─▶ [3] EXTRACT entity hints (mã, màu, size, số lượng, nơi giao) — có mặt ở mọi verdict
//       ─▶ [4] RULE ENGINE analyzeLiveCommentIntent (classify + score)   ──spam──▶ SKIP
//       ─▶ [5] PRESET OVERRIDE (khớp catalog shop + không phủ định → buy/high)
//       ─▶ [6] ROUTE (policy) ─▶ SKIP | RULE_RESOLVED | NEED_LLM
//
// Stage LLM (async) nằm ở comment-llm.ts và được index.ts gọi sau hàm này, để
// runCommentPipeline vẫn sync/pure cho test + benchmark.

import type { EntityHints, PipelineContext, PipelineResult, SkipReason } from "./comment-types.js";
import { ROUTING } from "./comment-config.js";
import { normalizeComment, normalizeRawComment, stripMetadataNoise } from "./comment-normalize.js";
import { detectCleanSkip, detectRawSkip } from "./comment-filter.js";
import { analyzeLiveCommentIntent, emptyIntentResult } from "./comment-intent.js";
import { EMPTY_HINTS, extractEntityHints, extractProductReference, hasNegation } from "./comment-extract.js";
import { decideRouting, defaultRoutingPolicy, type RoutingPolicy } from "./comment-routing.js";

export type { PipelineContext, PipelineResult, PipelineVerdict } from "./comment-types.js";
export type { RoutingPolicy } from "./comment-routing.js";

export type PipelineOptions = {
  routingPolicy?: RoutingPolicy;
};

function skip(
  reason: SkipReason,
  base: { rawText: string; cleanText: string; context: PipelineContext; hints?: EntityHints; result?: PipelineResult["result"] },
): PipelineResult {
  const result = base.result ?? emptyIntentResult();
  return {
    verdict: "SKIP",
    reason,
    intent: result.intent,
    result,
    hints: base.hints ?? { ...EMPTY_HINTS },
    rawText: base.rawText,
    cleanText: base.cleanText,
    context: base.context,
  };
}

export function runCommentPipeline(rawText: string, ctx: PipelineContext, opts: PipelineOptions = {}): PipelineResult {
  const raw = String(rawText || "").trim();
  const context: PipelineContext = { isHost: ctx.isHost, matchedPresetCode: ctx.matchedPresetCode ?? null };

  // [1] FILTER trên raw
  const rawSkip = detectRawSkip(raw);
  if (rawSkip) return skip(rawSkip, { rawText: raw, cleanText: "", context });

  // [2] NORMALIZE
  const clean = normalizeRawComment(raw);

  // [1'] FILTER trên clean
  const cleanSkip = detectCleanSkip(raw, clean, context.isHost);
  if (cleanSkip === "host_comment") {
    // vẫn chấm để giữ matchedReasons cho log/debug, nhưng ép về "user" và vô hiệu mọi cờ
    const r = analyzeLiveCommentIntent(clean);
    r.intent = "user";
    r.priorityLevel = "normal";
    r.finalScore = 0;
    r.canSuggestOrder = false;
    r.canCreateDraftOrder = false;
    r.canCreateOrder = false;
    r.isPotentialBuyer = false;
    return skip("host_comment", { rawText: raw, cleanText: clean, context, result: r });
  }
  if (cleanSkip === "system_event") {
    return skip("system_event", { rawText: raw, cleanText: clean, context, result: analyzeLiveCommentIntent(clean) });
  }
  if (cleanSkip) return skip(cleanSkip, { rawText: raw, cleanText: clean, context });

  // [3] EXTRACT entity hints — trước routing để SKIP/NEED_LLM vẫn có
  const productRef = extractProductReference(normalizeComment(stripMetadataNoise(raw)));
  const hints = extractEntityHints(clean, productRef);

  // [4] RULE ENGINE
  const result = analyzeLiveCommentIntent(clean, { shopBoost: Boolean(context.matchedPresetCode) });
  if (result.intent === "spam") return skip("spam_detected", { rawText: raw, cleanText: clean, context, hints, result });

  // [5] PRESET OVERRIDE — khớp catalog shop và không phủ định → chắc chắn là buy
  if (context.matchedPresetCode && result.intent !== "user" && !hasNegation(clean)) {
    result.intent = "buy";
    result.priorityLevel = "high";
    result.finalScore = Math.max(result.finalScore, ROUTING.presetOverrideScore);
    result.canCreateDraftOrder = true;
    result.canCreateOrder = true;
    result.isPotentialBuyer = true;
    if (result.parsedData) result.parsedData.productCode = context.matchedPresetCode;
    hints.productCode = context.matchedPresetCode;
    return { verdict: "RULE_RESOLVED", intent: "buy", result, hints, rawText: raw, cleanText: clean, context };
  }

  // [6] ROUTE
  const decision = decideRouting({ clean, result, hints, ctx: context }, opts.routingPolicy ?? defaultRoutingPolicy);
  const base = { intent: result.intent, result, hints, rawText: raw, cleanText: clean, context };
  switch (decision.verdict) {
    case "SKIP":
      return { verdict: "SKIP", reason: decision.reason, ...base };
    case "NEED_LLM":
      return { verdict: "NEED_LLM", missingFields: decision.missingFields, ...base };
    default:
      return { verdict: "RULE_RESOLVED", ...base };
  }
}
