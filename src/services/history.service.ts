import { supabaseAdmin } from "../lib/supabase.js";

export async function listLiveHistory({ shopId, limit = 100 }: { shopId: string; limit?: number }) {
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 300);

  const { data, error } = await supabaseAdmin
    .from("live_sessions")
    .select("*")
    .eq("shop_id", shopId)
    .order("started_at", { ascending: false })
    .limit(safeLimit);

  if (error) throw new Error(error.message);

  const sessions = data || [];
  if (!sessions.length) return [];

  const sessionIds = sessions.map((item: any) => item.id).filter(Boolean);
  if (!sessionIds.length) return sessions;

  const [{ data: orders, error: orderError }, { data: comments, error: commentError }] = await Promise.all([
    supabaseAdmin
      .from("orders")
      .select("*")
      .in("live_session_id", sessionIds)
      .order("created_at", { ascending: false }),
    supabaseAdmin
      .from("live_comments")
      .select("*")
      .in("live_session_id", sessionIds)
      .order("created_at", { ascending: false }),
  ]);

  if (orderError) throw new Error(orderError.message);
  if (commentError) throw new Error(commentError.message);

  const orderIds = (orders || []).map((order: any) => order.id);
  const itemsByOrderId = new Map<string, any[]>();

  if (orderIds.length > 0) {
    const { data: orderItems, error: orderItemsError } = await supabaseAdmin
      .from("order_items")
      .select("*")
      .in("order_id", orderIds);

    if (orderItemsError) throw new Error(orderItemsError.message);

    (orderItems || []).forEach((item: any) => {
      const oldItems = itemsByOrderId.get(item.order_id) || [];
      oldItems.push(item);
      itemsByOrderId.set(item.order_id, oldItems);
    });
  }

  const ordersBySessionId = new Map<string, any[]>();
  const commentsBySessionId = new Map<string, any[]>();

  (orders || []).forEach((order: any) => {
    const sessionId = String(order.live_session_id || "");
    const oldOrders = ordersBySessionId.get(sessionId) || [];
    oldOrders.push({ ...order, products: itemsByOrderId.get(order.id) || [] });
    ordersBySessionId.set(sessionId, oldOrders);
  });

  (comments || []).forEach((comment: any) => {
    const sessionId = String(comment.live_session_id || "");
    const oldComments = commentsBySessionId.get(sessionId) || [];
    oldComments.push(comment);
    commentsBySessionId.set(sessionId, oldComments);
  });

  return sessions
    .map((session: any) => {
      const sessionOrders = ordersBySessionId.get(session.id) || [];
      const sessionComments = commentsBySessionId.get(session.id) || [];
      return {
        ...session,
        orders: sessionOrders,
        comments: sessionComments,
        order_count: Math.max(Number(session.order_count || 0), sessionOrders.length),
        comment_count: Math.max(Number(session.comment_count || 0), sessionComments.length),
      };
    })
    .filter((session: any) => {
      const durationSeconds = Number(session.duration_seconds || 0);
      const commentCount = Number(session.comment_count || 0);
      const orderCount = Number(session.order_count || 0);
      return durationSeconds > 0 || commentCount > 0 || orderCount > 0;
    });
}
