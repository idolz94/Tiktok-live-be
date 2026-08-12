import { describe, it, expect } from "vitest";
import { analyzeLiveCommentIntent } from "./comment-intent.js";

describe("analyzeLiveCommentIntent", () => {
  it("flags question-style comments", () => {
    const result = analyzeLiveCommentIntent("Còn size M không?");

    expect(result.isQuestion).toBe(true);
    expect(result.intent).toBe("ask_product");
    expect(result.matchedReasons.length).toBeGreaterThan(0);
  });

  it("keeps plain comments as non-questions", () => {
    const result = analyzeLiveCommentIntent("Chốt 2 cái nhé");

    expect(result.isQuestion).toBe(false);
    expect(result.canCreateOrder).toBe(true);
  });
});
