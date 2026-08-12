import { and, eq } from "drizzle-orm";
import { db } from "../lib/db.js";
import { liveComments, liveSessions, orders } from "../db/schema/index.js";
import { notFound } from "../lib/api-error.js";

/**
 * Rule-based live session metrics. Everything here is derived from rows that the
 * live ingest flow already persists — no AI, no stored aggregates to keep in sync.
 */

// ponytail: mirrors isPotentialBuyer in utils/comment-intent.ts, which is computed but never persisted.
const BUYER_INTENTS = new Set([
  "buy",
  "ask_price",
  "ask_stock",
  "ask_shipping",
  "ask_product",
  "ask_how_to_buy",
]);

const INTENT_KEYS = [
  "buy",
  "ask_price",
  "ask_stock",
  "ask_shipping",
  "ask_product",
  "ask_how_to_buy",
  "normal",
  "spam",
  "user",
] as const;

const PRIORITY_KEYS = ["high", "medium", "low", "normal"] as const;

const SCORE_BUCKET_KEYS = ["0-34", "35-59", "60-84", "85-100"] as const;

const CANCELLED_ORDER_STATUSES = new Set(["cancelled", "canceled"]);

export type MetricsSessionRow = {
  id: string;
  status: string | null;
  startedAt: Date | null;
  endedAt: Date | null;
  durationSeconds: number | null;
  commentCount: number | null;
  orderCount: number | null;
  customerCount: number | null;
};

export type MetricsCommentRow = {
  intent: string | null;
  priorityLevel: string | null;
  finalScore: number | null;
  isOrderCreated: boolean | null;
  tiktokUsername: string | null;
};

export type MetricsOrderRow = {
  status: string | null;
  totalAmount: number | null;
};

function scoreBucket(score: number) {
  if (score >= 85) return "85-100";
  if (score >= 60) return "60-84";
  if (score >= 35) return "35-59";
  return "0-34";
}

/** Ratio in 0..1, 4 decimals. 0 when the denominator is empty. */
function rate(part: number, total: number) {
  if (total <= 0) return 0;
  return Math.round((part / total) * 10_000) / 10_000;
}

function emptyCounts<K extends string>(keys: readonly K[]) {
  return keys.reduce((acc, key) => {
    acc[key] = 0;
    return acc;
  }, {} as Record<K, number>);
}

export function deriveLiveSessionMetrics({
  session,
  comments,
  orders: orderRows,
}: {
  session: MetricsSessionRow;
  comments: MetricsCommentRow[];
  orders: MetricsOrderRow[];
}) {
  const byIntent = emptyCounts(INTENT_KEYS);
  const byPriority = emptyCounts(PRIORITY_KEYS);
  const scoreBuckets = emptyCounts(SCORE_BUCKET_KEYS);

  let hostCommentCount = 0;
  let spamCount = 0;
  let potentialBuyerCount = 0;
  let buyCommentCount = 0;
  let createdOrderCount = 0;
  const commenters = new Set<string>();

  for (const comment of comments) {
    const intent = comment.intent ?? "normal";
    const priority = comment.priorityLevel ?? "normal";
    const score = Number(comment.finalScore ?? 0);

    if (intent in byIntent) byIntent[intent as (typeof INTENT_KEYS)[number]] += 1;
    if (priority in byPriority) byPriority[priority as (typeof PRIORITY_KEYS)[number]] += 1;
    scoreBuckets[scoreBucket(score)] += 1;

    if (intent === "user") hostCommentCount += 1;
    if (intent === "spam") spamCount += 1;
    if (BUYER_INTENTS.has(intent)) potentialBuyerCount += 1;
    if (intent === "buy") buyCommentCount += 1;
    if (comment.isOrderCreated) createdOrderCount += 1;

    // Same exclusion as customerCommentCount: host and spam accounts are not customers.
    const username = (comment.tiktokUsername ?? "").trim();
    if (username && intent !== "user" && intent !== "spam") commenters.add(username.toLowerCase());
  }

  const total = comments.length;
  // Host and spam lines are not customer demand, so they stay out of every rate denominator.
  const customerCommentCount = Math.max(0, total - hostCommentCount - spamCount);

  let revenue = 0;
  let cancelledOrderCount = 0;
  for (const order of orderRows) {
    if (CANCELLED_ORDER_STATUSES.has(order.status ?? "")) {
      cancelledOrderCount += 1;
      continue;
    }
    revenue += Number(order.totalAmount ?? 0);
  }

  const orderCount = orderRows.length;

  return {
    session: {
      id: session.id,
      status: session.status ?? "running",
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      durationSeconds: Number(session.durationSeconds ?? 0),
      // ponytail: stored counters use non-atomic increments, so derived rows win when they are higher.
      commentCount: Math.max(Number(session.commentCount ?? 0), total),
      orderCount: Math.max(Number(session.orderCount ?? 0), orderCount),
      customerCount: Math.max(Number(session.customerCount ?? 0), commenters.size),
    },
    comments: {
      total,
      customerCommentCount,
      hostCommentCount,
      spamCount,
      uniqueCommenterCount: commenters.size,
      potentialBuyerCount,
      buyCommentCount,
      createdOrderCount,
      byIntent,
      byPriority,
      scoreBuckets,
    },
    rates: {
      buyerCommentRate: rate(potentialBuyerCount, customerCommentCount),
      highPriorityRate: rate(byPriority.high, customerCommentCount),
      orderConversionRate: rate(orderCount, potentialBuyerCount),
      buyCommentOrderRate: rate(createdOrderCount, buyCommentCount),
    },
    orders: {
      count: orderCount,
      cancelledCount: cancelledOrderCount,
      // Revenue excludes cancelled orders.
      revenue,
      liveSessionOrderCount: Number(session.orderCount ?? 0),
    },
  };
}

export type LiveSessionMetrics = ReturnType<typeof deriveLiveSessionMetrics>;

export async function getLiveSessionMetrics({
  shopId,
  sessionId,
}: {
  shopId: string;
  sessionId: string;
}): Promise<LiveSessionMetrics> {
  const sessionRows = await db
    .select({
      id: liveSessions.id,
      status: liveSessions.status,
      startedAt: liveSessions.startedAt,
      endedAt: liveSessions.endedAt,
      durationSeconds: liveSessions.durationSeconds,
      commentCount: liveSessions.commentCount,
      orderCount: liveSessions.orderCount,
      customerCount: liveSessions.customerCount,
    })
    .from(liveSessions)
    .where(and(eq(liveSessions.id, sessionId), eq(liveSessions.shopId, shopId)))
    .limit(1);

  const session = sessionRows[0];
  if (!session) throw notFound("Không tìm thấy phiên live.");

  // ponytail: reads the session's comment rows (narrow columns) instead of one grouped query per
  // dimension — swap to SQL GROUP BY if a single session ever outgrows a few thousand comments.
  const [commentRows, orderRows] = await Promise.all([
    db
      .select({
        intent: liveComments.intent,
        priorityLevel: liveComments.priorityLevel,
        finalScore: liveComments.finalScore,
        isOrderCreated: liveComments.isOrderCreated,
        tiktokUsername: liveComments.tiktokUsername,
      })
      .from(liveComments)
      .where(and(eq(liveComments.shopId, shopId), eq(liveComments.liveSessionId, sessionId))),
    db
      .select({ status: orders.status, totalAmount: orders.totalAmount })
      .from(orders)
      .where(and(eq(orders.shopId, shopId), eq(orders.liveSessionId, sessionId))),
  ]);

  return deriveLiveSessionMetrics({ session, comments: commentRows, orders: orderRows });
}
