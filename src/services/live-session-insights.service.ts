import {
  getLiveSessionMetrics,
  type LiveSessionMetrics,
} from "./live-session-metrics.service.js";

/**
 * Rule-based insight layer on top of the Phase 2 metrics. Pure derivation from the
 * metrics payload — no extra queries, no AI, same input always gives same output.
 */

// ponytail: thresholds are the calibration knob. Every shop streams differently, so tune here
// instead of rewriting rules. Swap to per-shop settings only when a shop actually needs it.
const THRESHOLDS = {
  strongBuyerRate: 0.25,
  weakBuyerRate: 0.05,
  minCustomerCommentsForDemand: 10,
  lowConversionRate: 0.2,
  minBuyersForConversion: 5,
  missedBuyCommentRate: 0.5,
  minBuyCommentsForMissed: 3,
  spamRate: 0.3,
  minCommentsForSpam: 10,
  highPriorityRate: 0.2,
  minHighPriorityComments: 5,
  cancelRate: 0.2,
  minOrdersForCancel: 5,
  quietCommentsPerMinute: 1,
  minSecondsForPace: 300,
};

export type InsightLevel = "good" | "warning" | "info";

export type LiveSessionInsight = {
  code: string;
  level: InsightLevel;
  title: string;
  detail: string;
  /** Present when the insight implies a concrete next action. */
  action?: string;
};

function round(value: number, decimals: number) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** 1234567 -> "1.234.567" (vi-VN grouping without depending on ICU data). */
function formatInt(value: number) {
  return Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function formatVnd(value: number) {
  return `${formatInt(value)}đ`;
}

function formatPercent(ratio: number) {
  return `${Math.round(ratio * 100)}%`;
}

function formatDuration(seconds: number) {
  if (seconds <= 0) return "chưa ghi nhận thời lượng";
  if (seconds < 60) return `${Math.round(seconds)} giây`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} phút`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} giờ ${rest} phút` : `${hours} giờ`;
}

function derivePace(metrics: LiveSessionMetrics) {
  const { durationSeconds } = metrics.session;
  const paidOrderCount = Math.max(0, metrics.orders.count - metrics.orders.cancelledCount);

  return {
    durationSeconds,
    commentsPerMinute:
      durationSeconds > 0 ? round(metrics.comments.total / (durationSeconds / 60), 2) : 0,
    ordersPerHour:
      durationSeconds > 0 ? round(metrics.orders.count / (durationSeconds / 3600), 2) : 0,
    averageOrderValue: paidOrderCount > 0 ? Math.round(metrics.orders.revenue / paidOrderCount) : 0,
  };
}

function buildSummary(metrics: LiveSessionMetrics, pace: ReturnType<typeof derivePace>) {
  const { comments, orders, session } = metrics;

  if (comments.total === 0) {
    return `Phiên live (${formatDuration(session.durationSeconds)}) chưa ghi nhận comment nào.`;
  }

  const sentences = [
    `Phiên live ${formatDuration(session.durationSeconds)} ghi nhận ${formatInt(comments.total)} comment từ ${formatInt(comments.uniqueCommenterCount)} người.`,
  ];

  if (comments.customerCommentCount > 0) {
    sentences.push(
      `${formatInt(comments.potentialBuyerCount)} comment có nhu cầu mua (${formatPercent(metrics.rates.buyerCommentRate)} comment khách).`,
    );
  }

  sentences.push(
    orders.count > 0
      ? `Đã tạo ${formatInt(orders.count)} đơn, doanh thu ${formatVnd(orders.revenue)}.`
      : "Chưa có đơn nào được tạo trong phiên.",
  );

  if (pace.commentsPerMinute > 0) {
    sentences.push(`Tốc độ trung bình ${pace.commentsPerMinute} comment/phút.`);
  }

  return sentences.join(" ");
}

function buildHighlights(metrics: LiveSessionMetrics, pace: ReturnType<typeof derivePace>) {
  const { comments, orders, rates } = metrics;
  const highlights: LiveSessionInsight[] = [];

  if (comments.total === 0) {
    highlights.push({
      code: "empty_session",
      level: "info",
      title: "Chưa có dữ liệu comment",
      detail: "Phiên này chưa có comment nào được lưu nên chưa thể đánh giá hiệu quả.",
      action: "Kiểm tra kết nối collector nếu phiên đã thực sự lên live.",
    });
    return highlights;
  }

  if (rates.buyerCommentRate >= THRESHOLDS.strongBuyerRate) {
    highlights.push({
      code: "strong_demand",
      level: "good",
      title: "Nhu cầu mua cao",
      detail: `${formatPercent(rates.buyerCommentRate)} comment khách thể hiện nhu cầu mua (${formatInt(comments.potentialBuyerCount)} comment).`,
    });
  }

  if (
    comments.customerCommentCount >= THRESHOLDS.minCustomerCommentsForDemand &&
    rates.buyerCommentRate < THRESHOLDS.weakBuyerRate
  ) {
    highlights.push({
      code: "weak_demand",
      level: "warning",
      title: "Ít comment có nhu cầu mua",
      detail: `Chỉ ${formatPercent(rates.buyerCommentRate)} comment khách liên quan tới mua hàng.`,
      action: "Chốt sản phẩm và giá rõ ràng hơn, nhắc lại cách đặt hàng trong phiên.",
    });
  }

  if (
    comments.potentialBuyerCount >= THRESHOLDS.minBuyersForConversion &&
    rates.orderConversionRate < THRESHOLDS.lowConversionRate
  ) {
    highlights.push({
      code: "low_conversion",
      level: "warning",
      title: "Nhiều khách quan tâm nhưng ít chốt đơn",
      detail: `${formatInt(comments.potentialBuyerCount)} comment có nhu cầu mua nhưng chỉ tạo ${formatInt(orders.count)} đơn (${formatPercent(rates.orderConversionRate)}).`,
      action: "Ưu tiên trả lời comment priority cao và chốt đơn ngay trong lúc live.",
    });
  }

  if (
    comments.buyCommentCount >= THRESHOLDS.minBuyCommentsForMissed &&
    rates.buyCommentOrderRate < THRESHOLDS.missedBuyCommentRate
  ) {
    const missed = Math.max(0, comments.buyCommentCount - comments.createdOrderCount);
    highlights.push({
      code: "missed_buy_comments",
      level: "warning",
      title: "Comment chốt mua chưa được tạo đơn",
      detail: `${formatInt(missed)} comment intent mua chưa gắn đơn nào.`,
      action: "Rà lại danh sách comment intent mua và tạo đơn cho khách còn thiếu.",
    });
  }

  const spamRate = comments.total > 0 ? comments.spamCount / comments.total : 0;
  if (comments.total >= THRESHOLDS.minCommentsForSpam && spamRate > THRESHOLDS.spamRate) {
    highlights.push({
      code: "spam_heavy",
      level: "warning",
      title: "Tỉ lệ spam cao",
      detail: `${formatPercent(spamRate)} comment bị đánh dấu spam (${formatInt(comments.spamCount)} comment).`,
      action: "Bật lọc spam hoặc bổ sung từ khóa spam để giảm nhiễu.",
    });
  }

  if (
    comments.byPriority.high >= THRESHOLDS.minHighPriorityComments &&
    rates.highPriorityRate >= THRESHOLDS.highPriorityRate
  ) {
    highlights.push({
      code: "high_priority_load",
      level: "info",
      title: "Nhiều comment ưu tiên cao",
      detail: `${formatInt(comments.byPriority.high)} comment ở mức ưu tiên cao (${formatPercent(rates.highPriorityRate)} comment khách).`,
      action: "Bố trí thêm người trực comment để không bỏ sót khách.",
    });
  }

  const cancelRate = orders.count > 0 ? orders.cancelledCount / orders.count : 0;
  if (orders.count >= THRESHOLDS.minOrdersForCancel && cancelRate > THRESHOLDS.cancelRate) {
    highlights.push({
      code: "cancel_heavy",
      level: "warning",
      title: "Tỉ lệ đơn hủy cao",
      detail: `${formatInt(orders.cancelledCount)}/${formatInt(orders.count)} đơn bị hủy (${formatPercent(cancelRate)}).`,
      action: "Xác nhận lại thông tin và nhu cầu của khách trước khi tạo đơn.",
    });
  }

  if (
    pace.durationSeconds >= THRESHOLDS.minSecondsForPace &&
    pace.commentsPerMinute < THRESHOLDS.quietCommentsPerMinute
  ) {
    highlights.push({
      code: "quiet_room",
      level: "info",
      title: "Tương tác thấp",
      detail: `Trung bình chỉ ${pace.commentsPerMinute} comment/phút trong ${formatDuration(pace.durationSeconds)}.`,
      action: "Tăng call-to-action và mini game để kéo tương tác trong phiên sau.",
    });
  }

  if (orders.count > 0 && pace.averageOrderValue > 0) {
    highlights.push({
      code: "order_value",
      level: "info",
      title: "Giá trị đơn trung bình",
      detail: `Mỗi đơn hợp lệ trung bình ${formatVnd(pace.averageOrderValue)}.`,
    });
  }

  return highlights;
}

export function deriveLiveSessionInsights(metrics: LiveSessionMetrics) {
  const pace = derivePace(metrics);
  const highlights = buildHighlights(metrics, pace);

  return {
    summary: buildSummary(metrics, pace),
    pace,
    highlights,
    // Recommendations are just the actionable highlights, so a rule never drifts from its advice.
    recommendations: highlights.flatMap((highlight) => highlight.action ?? []),
  };
}

export type LiveSessionInsights = ReturnType<typeof deriveLiveSessionInsights>;

export type LiveSessionReport = {
  metrics: LiveSessionMetrics;
  insights: LiveSessionInsights;
};

export async function getLiveSessionReport({
  shopId,
  sessionId,
}: {
  shopId: string;
  sessionId: string;
}): Promise<LiveSessionReport> {
  const metrics = await getLiveSessionMetrics({ shopId, sessionId });
  return { metrics, insights: deriveLiveSessionInsights(metrics) };
}
