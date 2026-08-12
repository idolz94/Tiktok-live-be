import { describe, expect, it } from "vitest";
import { deriveLiveSessionMetrics } from "./live-session-metrics.service.js";
import { deriveLiveSessionInsights } from "./live-session-insights.service.js";

function buildMetrics({
  sessionOverrides = {},
  comments,
  orders,
}: {
  sessionOverrides?: Partial<Parameters<typeof deriveLiveSessionMetrics>[0]["session"]>;
  comments: Parameters<typeof deriveLiveSessionMetrics>[0]["comments"];
  orders: Parameters<typeof deriveLiveSessionMetrics>[0]["orders"];
}) {
  return deriveLiveSessionMetrics({
    session: {
      id: "session-1",
      status: "running",
      startedAt: null,
      endedAt: null,
      durationSeconds: 0,
      commentCount: 0,
      orderCount: 0,
      customerCount: 0,
      ...sessionOverrides,
    },
    comments,
    orders,
  });
}

describe("deriveLiveSessionInsights", () => {
  it("returns an empty-session insight when no comments exist", () => {
    const metrics = buildMetrics({ comments: [], orders: [] });
    const result = deriveLiveSessionInsights(metrics);

    expect(result.summary).toContain("chưa ghi nhận comment nào");
    expect(result.highlights).toHaveLength(1);
    expect(result.highlights[0]).toMatchObject({
      code: "empty_session",
      level: "info",
    });
    expect(result.recommendations).toEqual([
      "Kiểm tra kết nối collector nếu phiên đã thực sự lên live.",
    ]);
  });

  it("highlights strong demand for a healthy session", () => {
    const metrics = buildMetrics({
      sessionOverrides: { durationSeconds: 420 },
      comments: [
        { intent: "buy", priorityLevel: "high", finalScore: 95, isOrderCreated: true, tiktokUsername: "@buyer1" },
        { intent: "buy", priorityLevel: "high", finalScore: 94, isOrderCreated: true, tiktokUsername: "@buyer2" },
        { intent: "buy", priorityLevel: "medium", finalScore: 93, isOrderCreated: true, tiktokUsername: "@buyer3" },
        { intent: "buy", priorityLevel: "medium", finalScore: 92, isOrderCreated: true, tiktokUsername: "@buyer4" },
        { intent: "ask_price", priorityLevel: "low", finalScore: 80, isOrderCreated: false, tiktokUsername: "@buyer5" },
        { intent: "ask_stock", priorityLevel: "low", finalScore: 78, isOrderCreated: false, tiktokUsername: "@buyer6" },
        { intent: "ask_product", priorityLevel: "low", finalScore: 76, isOrderCreated: false, tiktokUsername: "@buyer7" },
        { intent: "ask_how_to_buy", priorityLevel: "low", finalScore: 74, isOrderCreated: false, tiktokUsername: "@buyer8" },
        { intent: "normal", priorityLevel: "normal", finalScore: 30, isOrderCreated: false, tiktokUsername: "@fan1" },
        { intent: "normal", priorityLevel: "normal", finalScore: 28, isOrderCreated: false, tiktokUsername: "@fan2" },
      ],
      orders: [
        { status: "confirmed", totalAmount: 120000 },
        { status: "confirmed", totalAmount: 180000 },
        { status: "confirmed", totalAmount: 150000 },
        { status: "confirmed", totalAmount: 140000 },
      ],
    });

    const result = deriveLiveSessionInsights(metrics);

    expect(result.highlights.some((item) => item.code === "strong_demand")).toBe(true);
    expect(result.highlights.some((item) => item.level === "warning")).toBe(false);
    expect(result.summary).toContain("10 comment");
    expect(result.recommendations).toEqual([]);
  });

  it("surfaces multiple warning signals for a noisy low-conversion session", () => {
    const comments = [
      ...Array.from({ length: 10 }, (_, index) => ({
        intent: "spam",
        priorityLevel: "normal",
        finalScore: 12,
        isOrderCreated: false,
        tiktokUsername: `@spam${index}`,
      })),
      ...Array.from({ length: 5 }, (_, index) => ({
        intent: "buy",
        priorityLevel: "medium",
        finalScore: 92 - index,
        isOrderCreated: index === 0,
        tiktokUsername: `@buyer${index}`,
      })),
      ...Array.from({ length: 15 }, (_, index) => ({
        intent: index % 2 === 0 ? "ask_price" : "normal",
        priorityLevel: "normal",
        finalScore: 30 + index,
        isOrderCreated: false,
        tiktokUsername: `@fan${index}`,
      })),
    ];

    const metrics = buildMetrics({
      sessionOverrides: {
        durationSeconds: 900,
        commentCount: 30,
        orderCount: 1,
        customerCount: 30,
      },
      comments,
      orders: [{ status: "confirmed", totalAmount: 100000 }],
    });

    const result = deriveLiveSessionInsights(metrics);
    const codes = result.highlights.map((item) => item.code);

    expect(codes).toEqual(expect.arrayContaining([
      "spam_heavy",
      "low_conversion",
      "missed_buy_comments",
    ]));
    expect(result.recommendations).toEqual(
      expect.arrayContaining([
        "Bật lọc spam hoặc bổ sung từ khóa spam để giảm nhiễu.",
        "Ưu tiên trả lời comment priority cao và chốt đơn ngay trong lúc live.",
        "Rà lại danh sách comment intent mua và tạo đơn cho khách còn thiếu.",
      ]),
    );
    expect(result.summary).toContain("đơn");
  });
});
