import { describe, it, expect } from "vitest";
import { analyzeLiveCommentIntent } from "./comment-intent.js";

describe("analyzeLiveCommentIntent", () => {
  it("flags question-style comments without forcing unknown questions into product intent", () => {
    const result = analyzeLiveCommentIntent("Shop ơi livestream mấy giờ?");

    expect(result.isQuestion).toBe(true);
    expect(result.intent).toBe("normal");
    expect(result.priorityLevel).toBe("normal");
  });

  it("keeps buy intent when how-to-buy keywords also match", () => {
    const result = analyzeLiveCommentIntent("Mua sao shop, chốt 1 cái");

    expect(result.intent).toBe("buy");
    expect(result.canSuggestOrder).toBe(true);
    expect(result.canCreateDraftOrder).toBe(false);
    expect(result.canCreateOrder).toBe(false);
  });

  it("treats isolated size/color as weak product signal", () => {
    const result = analyzeLiveCommentIntent("Màu xanh size M");

    expect(result.intent).toBe("ask_product");
    expect(result.priorityLevel).toBe("normal");
    expect(result.finalScore).toBeLessThan(35);
    expect(result.canSuggestOrder).toBe(false);
  });

  it("keeps explicit product questions as medium priority", () => {
    const result = analyzeLiveCommentIntent("Còn size M không?");

    expect(result.isQuestion).toBe(true);
    expect(result.intent).toBe("ask_stock");
    expect(result.priorityLevel).toBe("medium");
    expect(result.matchedReasons.length).toBeGreaterThan(0);
  });
});
