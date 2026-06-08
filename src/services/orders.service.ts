import { badRequest, notFound } from "../lib/api-error.js";
import { supabaseAdmin } from "../lib/supabase.js";
import { getCommentAvatar, getCommentDisplayName, getCommentText } from "../utils/comment.js";
import { createOrderCode, isUuid } from "../utils/id.js";
import { getCommentTikTokUsername } from "../utils/tiktok.js";
import { findOrCreateCustomer, updateCustomerAfterOrder } from "./customer.service.js";
import { findDbLiveCommentId, updateLiveCommentOrder } from "./live-comments.service.js";
import { updateLiveSessionOrderCount } from "./live-sessions.service.js";

const DEFAULT_PRICE = 20;
const DEFAULT_QUANTITY = 1;

export async function listOrders(shopId: string) {
  const { data: orders, error: ordersError } = await supabaseAdmin
    .from("orders")
    .select("*")
    .eq("shop_id", shopId)
    .order("created_at", { ascending: false });

  if (ordersError) throw new Error(ordersError.message);

  const orderRows = orders || [];
  if (!orderRows.length) return [];

  const orderIds = orderRows.map((item: any) => item.id);

  const { data: orderItems, error: orderItemsError } = await supabaseAdmin
    .from("order_items")
    .select("*")
    .in("order_id", orderIds);

  if (orderItemsError) throw new Error(orderItemsError.message);

  const itemsByOrderId = new Map<string, any[]>();
  (orderItems || []).forEach((item: any) => {
    const oldItems = itemsByOrderId.get(item.order_id) || [];
    oldItems.push(item);
    itemsByOrderId.set(item.order_id, oldItems);
  });

  return orderRows.map((order: any) => ({ ...order, products: itemsByOrderId.get(order.id) || [] }));
}

export async function createOrderFromComment({
  shopId,
  userId,
  comment,
  liveSessionId,
  price = DEFAULT_PRICE,
  quantity = DEFAULT_QUANTITY,
  note = "",
}: {
  shopId: string;
  userId: string;
  comment: any;
  liveSessionId?: string | null;
  price?: number;
  quantity?: number;
  note?: string;
}) {
  const commentText = getCommentText(comment);
  const customerTikTokUsername = getCommentTikTokUsername(comment);
  const displayName = getCommentDisplayName(comment);
  const avatarUrl = getCommentAvatar(comment);

  if (!commentText) throw badRequest("Comment không có nội dung để tạo đơn.");

  const safePrice = Number.isFinite(Number(price)) ? Number(price) : DEFAULT_PRICE;
  const safeQuantity = Number.isFinite(Number(quantity)) ? Number(quantity) : DEFAULT_QUANTITY;

  const customer = await findOrCreateCustomer({
    shopId,
    tiktokUsername: customerTikTokUsername,
    displayName,
    avatarUrl,
  });

  const subtotalAmount = safePrice * safeQuantity;
  const shippingFee = 0;
  const discountAmount = 0;
  const totalAmount = subtotalAmount + shippingFee - discountAmount;
  const codAmount = 0;
  const liveCommentId = await findDbLiveCommentId({ shopId, comment });
  const dbLiveSessionId = isUuid(liveSessionId) ? liveSessionId : null;
  const now = new Date().toISOString();

  const { data: order, error: orderError } = await supabaseAdmin
    .from("orders")
    .insert({
      shop_id: shopId,
      customer_id: customer?.id || null,
      live_session_id: dbLiveSessionId,
      live_comment_id: liveCommentId,
      order_code: createOrderCode(),
      source: "live_comment",
      customer_name: displayName,
      customer_tiktok_username: customerTikTokUsername,
      customer_phone: "",
      customer_address: "",
      comment_text: commentText,
      status: "draft",
      deposit_status: "unpaid",
      payment_status: "unpaid",
      shipping_status: "not_shipped",
      subtotal_amount: subtotalAmount,
      shipping_fee: shippingFee,
      discount_amount: discountAmount,
      // total_amount: totalAmount,
      deposit_amount: 0,
      cod_amount: codAmount,
      note,
      created_by: userId,
      created_at: now,
      updated_at: now,
    })
    .select("*")
    .single();

  if (orderError) throw new Error(orderError.message);

  const { error: orderItemError } = await supabaseAdmin
    .from("order_items")
    .insert({
      order_id: order.id,
      shop_id: shopId,
      product_code: "",
      product_name: commentText,
      variant_name: "",
      color: "",
      size: "",
      quantity: safeQuantity,
      price: safePrice,
      // total_amount: subtotalAmount,
      raw_comment_text: commentText,
      created_at: now,
      updated_at: now,
    });

  if (orderItemError) throw new Error(orderItemError.message);

  void Promise.all([
    updateLiveCommentOrder({ commentId: liveCommentId, orderId: order.id }),
    updateLiveSessionOrderCount(dbLiveSessionId),
    updateCustomerAfterOrder({ customerId: customer?.id || null, totalAmount }),
  ]).catch((error) => {
    console.error("CREATE_ORDER_FROM_COMMENT_SIDE_EFFECT_FAILED", error);
  });

  return {
    success: true,
    message: "Tạo đơn thành công.",
    orderId: order.id,
    orderCode: order.order_code,
  };
}

async function assertOrderInShop(orderId: string, shopId: string) {
  const { data, error } = await supabaseAdmin
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .eq("shop_id", shopId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw notFound("Không tìm thấy đơn hàng.");
  return data;
}

export async function updateOrderDepositStatus({
  shopId,
  orderId,
  depositStatus,
}: {
  shopId: string;
  orderId: string;
  depositStatus: string;
}) {
  await assertOrderInShop(orderId, shopId);

  const paymentStatus = depositStatus === "paid" ? "paid" : depositStatus === "deposited" ? "partial" : "unpaid";
  const { data, error } = await supabaseAdmin
    .from("orders")
    .update({ deposit_status: depositStatus, payment_status: paymentStatus, updated_at: new Date().toISOString() })
    .eq("id", orderId)
    .eq("shop_id", shopId)
    .select("*")
    .single();

  if (error) throw new Error(error.message);

  const { data: products, error: itemError } = await supabaseAdmin
    .from("order_items")
    .select("*")
    .eq("order_id", orderId);

  if (itemError) throw new Error(itemError.message);
  return { ...data, products: products || [] };
}

export async function updateOrderStatus({
  shopId,
  orderId,
  status,
}: {
  shopId: string;
  orderId: string;
  status: string;
}) {
  await assertOrderInShop(orderId, shopId);

  const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
  if (status === "confirmed") patch.confirmed_at = new Date().toISOString();
  if (status === "canceled") patch.canceled_at = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from("orders")
    .update(patch)
    .eq("id", orderId)
    .eq("shop_id", shopId)
    .select("*")
    .single();

  if (error) throw new Error(error.message);

  const { data: products, error: itemError } = await supabaseAdmin
    .from("order_items")
    .select("*")
    .eq("order_id", orderId);

  if (itemError) throw new Error(itemError.message);
  return { ...data, products: products || [] };
}

export async function deleteOrder({ shopId, orderId }: { shopId: string; orderId: string }) {
  await assertOrderInShop(orderId, shopId);

  const { error } = await supabaseAdmin.from("orders").delete().eq("id", orderId).eq("shop_id", shopId);
  if (error) throw new Error(error.message);

  return { ok: true };
}
