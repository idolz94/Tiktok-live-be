// ponytail: VÍ DỤ resolver LLM — chưa được wire vào đâu, chỉ là khung để cắm model thật vào sau.
//
// Cách dùng (ở src/server.ts, trước khi listen):
//
//   import { configureCommentScoring } from "./services/comment-scoring/index.js";
//   import { createHttpJsonLlmResolver } from "./services/comment-scoring/comment-llm-resolver.example.js";
//   if (process.env.LIVE_COMMENT_LLM_URL) {
//     configureCommentScoring({ llmResolver: createHttpJsonLlmResolver({
//       url: process.env.LIVE_COMMENT_LLM_URL,
//       apiKey: process.env.LIVE_COMMENT_LLM_API_KEY,
//       model: process.env.LIVE_COMMENT_LLM_MODEL ?? "gpt-4o-mini",
//     }) });
//   }
//
// Resolver chỉ được gọi cho comment NEED_LLM (buy nhưng chưa rõ sản phẩm). Output đi qua
// mergeLlmOutput nên intent lạ / score ngoài khoảng đều bị chặn — nhưng vẫn nên prompt model
// trả đúng schema để đỡ fallback.

import type { CommentIntent, LlmIntentResolver, LlmResolveInput, LlmResolveOutput } from "./comment-types.js";

const INTENTS: CommentIntent[] = [
  "buy", "already_ordered", "ask_price", "ask_stock", "ask_shipping", "ask_product",
  "ask_product_demo", "ask_how_to_buy", "undecided", "normal", "spam",
];

export function buildIntentPrompt(input: LlmResolveInput): { system: string; user: string } {
  const system = [
    "Bạn phân loại comment của khách trong livestream bán hàng TikTok (tiếng Việt, viết tắt, không dấu).",
    `Trả về DUY NHẤT 1 JSON: {"intent": one of [${INTENTS.join(", ")}], "finalScore": 0-100,`,
    ' "parsedData": {"productCode": string|null, "color": string|null, "size": string|null, "quantity": number|null}, "reasons": string[]}.',
    "finalScore >= 85 chỉ khi khách rõ ràng muốn mua 1 sản phẩm cụ thể. Không suy đoán mã sản phẩm nếu comment không nhắc tới.",
  ].join("\n");
  const user = JSON.stringify({
    comment: input.rawText,
    ruleGuess: { intent: input.ruleResult.intent, finalScore: input.ruleResult.finalScore, reasons: input.ruleResult.matchedReasons },
    entityHints: input.hints,
    missingFields: input.missingFields,
    matchedPresetCode: input.context.matchedPresetCode ?? null,
  });
  return { system, user };
}

export type HttpJsonLlmResolverOptions = {
  /** OpenAI-compatible chat completions endpoint */
  url: string;
  apiKey?: string;
  model: string;
  name?: string;
};

/**
 * Resolver gọi 1 endpoint chat-completions kiểu OpenAI và parse JSON trong content.
 * Tôn trọng `signal` để timeout của resolveWithLlm huỷ được request.
 */
export function createHttpJsonLlmResolver(opts: HttpJsonLlmResolverOptions): LlmIntentResolver {
  return {
    name: opts.name ?? `http:${opts.model}`,
    async resolve(input, { signal }): Promise<LlmResolveOutput | null> {
      const { system, user } = buildIntentPrompt(input);
      const res = await fetch(opts.url, {
        method: "POST",
        signal,
        headers: {
          "content-type": "application/json",
          ...(opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: opts.model,
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
      });
      if (!res.ok) throw new Error(`llm http ${res.status}`);
      const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const content = body.choices?.[0]?.message?.content;
      if (!content) return null;
      const parsed = JSON.parse(content) as LlmResolveOutput;
      return parsed && typeof parsed === "object" ? parsed : null;
    },
  };
}
