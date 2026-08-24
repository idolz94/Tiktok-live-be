import { describe, it, expect } from "vitest";
import { runCommentPipeline } from "./comment-pipeline.js";
import { createStaticLlmResolver, mergeLlmOutput, resolveWithLlm } from "./comment-llm.js";
import type { LlmIntentResolver } from "./comment-types.js";

const ctx = { isHost: false, matchedPresetCode: null };

describe("LLM stage — resolveWithLlm", () => {
  it("không có resolver → pass-through, resolvedBy=rule, verdict giữ nguyên", async () => {
    const p = runCommentPipeline("chốt đơn", ctx);
    expect(p.verdict).toBe("NEED_LLM");
    const r = await resolveWithLlm(p, {});
    expect(r.verdict).toBe("NEED_LLM");
    expect(r.resolvedBy).toBe("rule");
    expect(r.result).toBe(p.result);
  });

  it("verdict không phải NEED_LLM → không gọi resolver", async () => {
    let called = 0;
    const resolver: LlmIntentResolver = { name: "spy", async resolve() { called++; return { intent: "buy" }; } };
    for (const t of ["giá bao nhiêu shop", "hello shop", "😂"]) {
      const r = await resolveWithLlm(runCommentPipeline(t, ctx), { resolver });
      expect(r.resolvedBy).toBe("rule");
    }
    expect(called).toBe(0);
  });

  it("resolver trả output → LLM_RESOLVED, flags phái sinh tính lại", async () => {
    const p = runCommentPipeline("chốt đơn", ctx);
    const resolver = createStaticLlmResolver({
      intent: "buy",
      finalScore: 95,
      parsedData: { productCode: "S03", quantity: 2 },
      reasons: ["khách nhắc S03 ở comment trước"],
    }, "static-test");
    const r = await resolveWithLlm(p, { resolver });
    expect(r.verdict).toBe("LLM_RESOLVED");
    expect(r.resolvedBy).toBe("llm");
    expect(r.intent).toBe("buy");
    expect(r.result.finalScore).toBe(95);
    expect(r.result.priorityLevel).toBe("high");
    expect(r.result.productReference).toBe("S03");
    expect(r.result.parsedData?.quantity).toBe(2);
    expect(r.result.canCreateDraftOrder).toBe(true);
    expect(r.result.missingFields).toEqual([]);
    expect(r.hints.productCode).toBe("S03");
    expect(r.result.matchedReasons.at(-1)).toContain("LLM(static-test):");
  });

  it("resolver hạ intent về normal → cờ mua tắt hết", async () => {
    const p = runCommentPipeline("lấy 2 cái", ctx);
    const r = await resolveWithLlm(p, { resolver: createStaticLlmResolver({ intent: "normal", finalScore: 10 }) });
    expect(r.result.intent).toBe("normal");
    expect(r.result.canSuggestOrder).toBe(false);
    expect(r.result.canCreateDraftOrder).toBe(false);
    expect(r.result.canCreateOrder).toBe(false);
    expect(r.result.isPotentialBuyer).toBe(false);
    expect(r.result.priorityLevel).toBe("normal");
  });

  it("resolver trả null → rule_fallback, kết quả rule giữ nguyên", async () => {
    const p = runCommentPipeline("chốt đơn", ctx);
    const r = await resolveWithLlm(p, { resolver: createStaticLlmResolver(null) });
    expect(r.verdict).toBe("NEED_LLM");
    expect(r.resolvedBy).toBe("rule_fallback");
    expect(r.result).toBe(p.result);
  });

  it("resolver throw → rule_fallback, không throw ra ngoài", async () => {
    const p = runCommentPipeline("chốt đơn", ctx);
    const resolver: LlmIntentResolver = { name: "boom", async resolve() { throw new Error("rate limited"); } };
    const r = await resolveWithLlm(p, { resolver });
    expect(r.resolvedBy).toBe("rule_fallback");
    expect(r.llmError).toContain("rate limited");
  });

  it("resolver quá timeout → rule_fallback + abort signal", async () => {
    const p = runCommentPipeline("chốt đơn", ctx);
    let aborted = false;
    const resolver: LlmIntentResolver = {
      name: "slow",
      resolve: (_input, { signal }) =>
        new Promise((resolve) => {
          signal.addEventListener("abort", () => { aborted = true; });
          setTimeout(() => resolve({ intent: "buy" }), 200);
        }),
    };
    const r = await resolveWithLlm(p, { resolver, timeoutMs: 20 });
    expect(r.resolvedBy).toBe("rule_fallback");
    expect(r.llmError).toContain("timeout");
    expect(aborted).toBe(true);
  });
});

describe("mergeLlmOutput — an toàn", () => {
  const rule = runCommentPipeline("chốt đơn", ctx).result;

  it("intent lạ → giữ intent rule", () => {
    const m = mergeLlmOutput(rule, { intent: "hack" as any }, "x");
    expect(m.intent).toBe(rule.intent);
  });
  it("score ngoài khoảng → clamp 0–100", () => {
    expect(mergeLlmOutput(rule, { finalScore: 999 }, "x").finalScore).toBe(100);
    expect(mergeLlmOutput(rule, { finalScore: -5 }, "x").finalScore).toBe(0);
  });
  it("NaN → giữ giá trị rule", () => {
    const m = mergeLlmOutput(rule, { finalScore: Number.NaN }, "x");
    expect(m.finalScore).toBe(rule.finalScore);
  });
  it("không có productCode → canCreateDraftOrder vẫn false dù intent buy", () => {
    const m = mergeLlmOutput(rule, { intent: "buy", finalScore: 99 }, "x");
    expect(m.canCreateDraftOrder).toBe(false);
    expect(m.missingFields).toContain("product");
  });
});
