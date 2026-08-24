// ponytail: stage LLM — hook để cắm model vào SAU rule engine.
//
//   pipeline (rule) ──verdict NEED_LLM──▶ resolveWithLlm(resolver) ──▶ LLM_RESOLVED
//                  └─ SKIP / RULE_RESOLVED ────────────────────────▶ giữ nguyên (không gọi LLM)
//
// Nguyên tắc:
//   1. Không có resolver          → trả kết quả rule y nguyên (resolvedBy = "rule").
//   2. Resolver lỗi / timeout / null → fallback kết quả rule (resolvedBy = "rule_fallback"),
//      KHÔNG throw — ingest comment không được chết vì LLM.
//   3. Output LLM đi qua `mergeLlmOutput`: intent phải hợp lệ, score clamp 0–100, các flag
//      phái sinh (priority, canSuggestOrder, canCreateDraftOrder...) TÍNH LẠI qua
//      finalizeIntentResult — LLM không được set trực tiếp cờ tạo đơn.
//
// Để cắm LLM thật: implement interface LlmIntentResolver (comment-types.ts) rồi gọi
// configureCommentScoring({ llmResolver }) ở bootstrap (index.ts). Xem `createStaticLlmResolver`
// bên dưới làm ví dụ tối giản (dùng cho test).

import type {
  CommentIntent,
  CommentIntentResult,
  LlmIntentResolver,
  LlmResolveInput,
  LlmResolveOutput,
  PipelineResult,
  ResolvedPipelineResult,
} from "./comment-types.js";
import { LLM_RESOLVE } from "./comment-config.js";
import { finalizeIntentResult } from "./comment-intent.js";

const VALID_INTENTS: ReadonlySet<string> = new Set<CommentIntent>([
  "buy", "already_ordered", "ask_price", "ask_stock", "ask_shipping", "ask_product",
  "ask_product_demo", "ask_how_to_buy", "undecided", "normal", "spam", "user",
]);

/**
 * Ghép output LLM lên kết quả rule. Pure — export để test riêng.
 */
export function mergeLlmOutput(rule: CommentIntentResult, out: LlmResolveOutput, resolverName: string): CommentIntentResult {
  const intent: CommentIntent = out.intent && VALID_INTENTS.has(out.intent) ? out.intent : rule.intent;
  const parsedData = {
    productCode: out.parsedData?.productCode ?? rule.parsedData?.productCode ?? null,
    color: out.parsedData?.color ?? rule.parsedData?.color ?? null,
    size: out.parsedData?.size ?? rule.parsedData?.size ?? null,
    quantity: out.parsedData?.quantity ?? rule.parsedData?.quantity ?? null,
  };
  const productReference = parsedData.productCode ?? rule.productReference;
  const matchedReasons = [
    ...rule.matchedReasons,
    ...(out.reasons ?? []).map((r) => `LLM(${resolverName}): ${r}`),
  ];

  const merged = finalizeIntentResult({
    intent,
    finalScore: typeof out.finalScore === "number" && Number.isFinite(out.finalScore) ? out.finalScore : rule.finalScore,
    topic: rule.topic,
    isQuestion: rule.isQuestion,
    matchedReasons,
    productReference: productReference ?? undefined,
    parsedData,
  });
  if (out.suggestedReply) merged.suggestedReply = out.suggestedReply;
  return merged;
}

function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`llm resolver timeout after ${timeoutMs}ms`)), timeoutMs);
  return new Promise<T>((resolve, reject) => {
    controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true });
    run(controller.signal).then(resolve, reject);
  }).finally(() => clearTimeout(timer));
}

export type ResolveWithLlmOptions = {
  resolver?: LlmIntentResolver | null;
  timeoutMs?: number;
  shopId?: string | null;
};

/**
 * Bước cuối của pipeline: chỉ xử lý verdict NEED_LLM, còn lại pass-through.
 */
export async function resolveWithLlm(pipeline: PipelineResult, opts: ResolveWithLlmOptions = {}): Promise<ResolvedPipelineResult> {
  if (pipeline.verdict !== "NEED_LLM" || !opts.resolver) {
    return { ...pipeline, resolvedBy: "rule" };
  }

  const resolver = opts.resolver;
  const input: LlmResolveInput = {
    rawText: pipeline.rawText,
    cleanText: pipeline.cleanText,
    ruleResult: pipeline.result,
    hints: pipeline.hints,
    missingFields: pipeline.missingFields,
    context: { shopId: opts.shopId ?? null, matchedPresetCode: pipeline.context.matchedPresetCode ?? null },
  };

  try {
    const out = await withTimeout((signal) => resolver.resolve(input, { signal }), opts.timeoutMs ?? LLM_RESOLVE.timeoutMs);
    if (!out) return { ...pipeline, resolvedBy: "rule_fallback", llmError: "resolver returned null" };

    const result = mergeLlmOutput(pipeline.result, out, resolver.name);
    return {
      verdict: "LLM_RESOLVED",
      resolver: resolver.name,
      intent: result.intent,
      result,
      hints: { ...pipeline.hints, productCode: result.parsedData?.productCode ?? pipeline.hints.productCode },
      rawText: pipeline.rawText,
      cleanText: pipeline.cleanText,
      context: pipeline.context,
      resolvedBy: "llm",
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { ...pipeline, resolvedBy: "rule_fallback", llmError: message };
  }
}

/**
 * Resolver tĩnh — trả cùng 1 output cho mọi input. Dùng cho test/dev, và làm mẫu để implement
 * resolver thật (gọi OpenAI/Claude/local model bên trong `resolve`, tôn trọng `signal`).
 */
export function createStaticLlmResolver(output: LlmResolveOutput | null, name = "static"): LlmIntentResolver {
  return {
    name,
    async resolve() {
      return output;
    },
  };
}
