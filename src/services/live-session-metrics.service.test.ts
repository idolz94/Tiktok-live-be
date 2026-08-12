import { describe, expect, it } from "vitest";
import { deriveLiveSessionMetrics } from "./live-session-metrics.service.js";

describe("deriveLiveSessionMetrics", () => {
  it("returns empty counts for an empty session", () => {
    const result = deriveLiveSessionMetrics({
      session: {
        id: "session-1",
        status: "running",
        startedAt: null,
        endedAt: null,
        durationSeconds: 0,
        commentCount: 0,
        orderCount: 0,
        customerCount: 0,
      },
      comments: [],
      orders: [],
    });

    expect(result.session.commentCount).toBe(0);
    expect(result.session.orderCount).toBe(0);
    expect(result.session.customerCount).toBe(0);
    expect(result.comments.total).toBe(0);
    expect(result.comments.customerCommentCount).toBe(0);
    expect(result.comments.potentialBuyerCount).toBe(0);
    expect(result.comments.byIntent.buy).toBe(0);
    expect(result.comments.byPriority.high).toBe(0);
    expect(result.comments.scoreBuckets["0-34"]).toBe(0);
    expect(result.rates.buyerCommentRate).toBe(0);
    expect(result.orders.revenue).toBe(0);
  });

  it("derives counts, buckets, and rates from persisted rows", () => {
    const result = deriveLiveSessionMetrics({
      session: {
        id: "session-1",
        status: "running",
        startedAt: null,
        endedAt: null,
        durationSeconds: 120,
        commentCount: 1,
        orderCount: 0,
        customerCount: 1,
      },
      comments: [
        {
          intent: "buy",
          priorityLevel: "high",
          finalScore: 92,
          isOrderCreated: true,
          tiktokUsername: "@buyer",
        },
        {
          intent: "ask_price",
          priorityLevel: "medium",
          finalScore: 66,
          isOrderCreated: false,
          tiktokUsername: "@buyer2",
        },
        {
          intent: "spam",
          priorityLevel: "normal",
          finalScore: 12,
          isOrderCreated: false,
          tiktokUsername: "@spam",
        },
        {
          intent: "user",
          priorityLevel: "normal",
          finalScore: 0,
          isOrderCreated: false,
          tiktokUsername: "@host",
        },
      ],
      orders: [
        { status: "confirmed", totalAmount: 150000 },
        { status: "cancelled", totalAmount: 250000 },
      ],
    });

    expect(result.session.commentCount).toBe(4);
    expect(result.session.orderCount).toBe(2);
    expect(result.session.customerCount).toBe(2);
    expect(result.comments.total).toBe(4);
    expect(result.comments.hostCommentCount).toBe(1);
    expect(result.comments.spamCount).toBe(1);
    expect(result.comments.customerCommentCount).toBe(2);
    expect(result.comments.uniqueCommenterCount).toBe(2);
    expect(result.comments.potentialBuyerCount).toBe(2);
    expect(result.comments.buyCommentCount).toBe(1);
    expect(result.comments.createdOrderCount).toBe(1);
    expect(result.comments.byIntent.buy).toBe(1);
    expect(result.comments.byIntent.ask_price).toBe(1);
    expect(result.comments.byPriority.high).toBe(1);
    expect(result.comments.byPriority.medium).toBe(1);
    expect(result.comments.scoreBuckets["85-100"]).toBe(1);
    expect(result.comments.scoreBuckets["60-84"]).toBe(1);
    expect(result.comments.scoreBuckets["0-34"]).toBe(2);
    expect(result.rates.buyerCommentRate).toBe(1);
    expect(result.rates.highPriorityRate).toBe(0.5);
    expect(result.rates.orderConversionRate).toBe(1);
    expect(result.rates.buyCommentOrderRate).toBe(1);
    expect(result.orders.count).toBe(2);
    expect(result.orders.cancelledCount).toBe(1);
    expect(result.orders.revenue).toBe(150000);
    expect(result.orders.liveSessionOrderCount).toBe(0);
  });

  it("keeps derived counters ahead of stale stored counters", () => {
    const result = deriveLiveSessionMetrics({
      session: {
        id: "session-1",
        status: "ended",
        startedAt: null,
        endedAt: null,
        durationSeconds: 0,
        commentCount: 2,
        orderCount: 1,
        customerCount: 1,
      },
      comments: [
        {
          intent: "buy",
          priorityLevel: "high",
          finalScore: 90,
          isOrderCreated: true,
          tiktokUsername: "@buyer",
        },
        {
          intent: "ask_product",
          priorityLevel: "low",
          finalScore: 40,
          isOrderCreated: false,
          tiktokUsername: "@buyer",
        },
      ],
      orders: [{ status: "confirmed", totalAmount: 100000 }],
    });

    expect(result.session.commentCount).toBe(2);
    expect(result.session.orderCount).toBe(1);
    expect(result.session.customerCount).toBe(1);
    expect(result.comments.uniqueCommenterCount).toBe(1);
    expect(result.rates.orderConversionRate).toBe(0.5);
  });
});
