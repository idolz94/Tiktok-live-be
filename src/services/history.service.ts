import { eq, inArray, sql } from "drizzle-orm";
import { db } from "../lib/db.js";
import { liveSessions, orders, orderItems, liveComments } from "../db/schema/index.js";

export async function listLiveHistory({ shopId, limit = 100 }: { shopId: string; limit?: number }) {
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 300);

  const sessions = await db
    .select()
    .from(liveSessions)
    .where(eq(liveSessions.shopId, shopId))
    .orderBy(sql`${liveSessions.startedAt} desc`)
    .limit(safeLimit);

  if (!sessions.length) return [];

  const sessionIds = sessions.map((item) => item.id).filter(Boolean);
  if (!sessionIds.length) return sessions;

  const [orderRows, commentRows] = await Promise.all([
    db
      .select()
      .from(orders)
      .where(inArray(orders.liveSessionId, sessionIds))
      .orderBy(sql`${orders.createdAt} desc`),
    db
      .select()
      .from(liveComments)
      .where(inArray(liveComments.liveSessionId, sessionIds))
      .orderBy(sql`${liveComments.createdAt} desc`),
  ]);

  const orderIds = orderRows.map((order) => order.id);
  const itemsByOrderId = new Map<string, any[]>();

  if (orderIds.length > 0) {
    const items = await db.select().from(orderItems).where(inArray(orderItems.orderId, orderIds));
    for (const item of items) {
      const list = itemsByOrderId.get(item.orderId) ?? [];
      list.push(item);
      itemsByOrderId.set(item.orderId, list);
    }
  }

  const ordersBySessionId = new Map<string, any[]>();
  const commentsBySessionId = new Map<string, any[]>();

  for (const order of orderRows) {
    const sessionId = String(order.liveSessionId || "");
    const list = ordersBySessionId.get(sessionId) ?? [];
    list.push({ ...order, products: itemsByOrderId.get(order.id) ?? [] });
    ordersBySessionId.set(sessionId, list);
  }

  for (const comment of commentRows) {
    const sessionId = String(comment.liveSessionId || "");
    const list = commentsBySessionId.get(sessionId) ?? [];
    list.push(comment);
    commentsBySessionId.set(sessionId, list);
  }

  return sessions
    .map((session) => {
      const sessionOrders = ordersBySessionId.get(session.id) ?? [];
      const sessionComments = commentsBySessionId.get(session.id) ?? [];
      return {
        ...session,
        orders: sessionOrders,
        comments: sessionComments,
        commentCount: Math.max(Number(session.commentCount || 0), sessionComments.length),
        orderCount: Math.max(Number(session.orderCount || 0), sessionOrders.length),
      };
    })
    .filter((session) => Number(session.commentCount || 0) > 0 || Number(session.orderCount || 0) > 0);
}
