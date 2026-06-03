import { supabaseAdmin } from "../lib/supabase.js";

export async function findOrCreateCustomer({
  shopId,
  tiktokUsername,
  displayName,
  avatarUrl,
}: {
  shopId: string;
  tiktokUsername: string;
  displayName: string;
  avatarUrl: string;
}) {
  const normalizedUsername = String(tiktokUsername || "").trim();
  if (!normalizedUsername) return null;

  const { data: existedCustomer, error: findError } = await supabaseAdmin
    .from("customers")
    .select("*")
    .eq("shop_id", shopId)
    .eq("tiktok_username", normalizedUsername)
    .maybeSingle();

  if (findError) throw new Error(findError.message);
  if (existedCustomer) return existedCustomer;

  const now = new Date().toISOString();
  const { data: newCustomer, error: createError } = await supabaseAdmin
    .from("customers")
    .insert({
      shop_id: shopId,
      tiktok_username: normalizedUsername,
      tiktok_unique_id: normalizedUsername.replace(/^@/, ""),
      display_name: displayName,
      avatar_url: avatarUrl,
      total_orders: 0,
      total_spent: 0,
      tags: [],
      created_at: now,
      updated_at: now,
    })
    .select("*")
    .single();

  if (createError) throw new Error(createError.message);
  return newCustomer;
}

export async function updateCustomerAfterOrder({
  customerId,
  totalAmount,
}: {
  customerId?: string | null;
  totalAmount: number;
}) {
  if (!customerId) return;

  const { data: customer, error: findError } = await supabaseAdmin
    .from("customers")
    .select("id,total_orders,total_spent")
    .eq("id", customerId)
    .maybeSingle();

  if (findError) throw new Error(findError.message);
  if (!customer) return;

  const { error } = await supabaseAdmin
    .from("customers")
    .update({
      total_orders: Number(customer.total_orders || 0) + 1,
      total_spent: Number(customer.total_spent || 0) + totalAmount,
      last_order_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", customerId);

  if (error) throw new Error(error.message);
}
