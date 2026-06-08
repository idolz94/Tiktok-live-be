import { badRequest, notFound } from "../lib/api-error.js";
import { supabaseAdmin } from "../lib/supabase.js";
import { normalizeAtUsername } from "../utils/tiktok.js";

export async function listTikTokChannels(shopId: string) {
  const { data, error } = await supabaseAdmin
    .from("shop_tiktok_channels")
    .select("*")
    .eq("shop_id", shopId)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  return data || [];
}

export async function createTikTokChannel({
  shopId,
  tiktokUsername,
  displayName,
  isDefault = false,
}: {
  shopId: string;
  tiktokUsername: string;
  displayName?: string | null;
  isDefault?: boolean;
}) {
  const normalizedUsername = normalizeAtUsername(tiktokUsername);
  if (!normalizedUsername) throw badRequest("Thiếu TikTok username.");

  const { data: existingChannels, error: countError } = await supabaseAdmin
    .from("shop_tiktok_channels")
    .select("id")
    .eq("shop_id", shopId);

  if (countError) throw new Error(countError.message);

  const shouldBeDefault = isDefault || !existingChannels?.length;

  if (shouldBeDefault) {
    await clearDefaultTikTokChannel(shopId);
  }

  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("shop_tiktok_channels")
    .insert({
      shop_id: shopId,
      tiktok_username: normalizedUsername,
      display_name: displayName || null,
      is_default: shouldBeDefault,
      created_at: now,
      updated_at: now,
    })
    .select("*")
    .single();

  if (error) throw new Error(error.message);

  if (shouldBeDefault) {
    await updateShopDefaultTikTokUsername(shopId, normalizedUsername);
  }

  return data;
}

export async function updateTikTokChannel({
  shopId,
  channelId,
  tiktokUsername,
  displayName,
  isDefault,
}: {
  shopId: string;
  channelId: string;
  tiktokUsername?: string | null;
  displayName?: string | null;
  isDefault?: boolean;
}) {
  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (typeof tiktokUsername === "string") {
    const normalizedUsername = normalizeAtUsername(tiktokUsername);
    if (!normalizedUsername) throw badRequest("Thiếu TikTok username.");
    patch.tiktok_username = normalizedUsername;
  }

  if (typeof displayName === "string") {
    patch.display_name = displayName || null;
  }

  if (isDefault === true) {
    await clearDefaultTikTokChannel(shopId);
    patch.is_default = true;
  }

  const { data, error } = await supabaseAdmin
    .from("shop_tiktok_channels")
    .update(patch)
    .eq("id", channelId)
    .eq("shop_id", shopId)
    .select("*")
    .single();

  if (error) throw new Error(error.message);

  if (!data) throw notFound("Không tìm thấy kênh TikTok.");

  if (data.is_default) {
    await updateShopDefaultTikTokUsername(shopId, data.tiktok_username);
  }

  return data;
}

export async function deleteTikTokChannel({ shopId, channelId }: { shopId: string; channelId: string }) {
  const { data: channel, error: findError } = await supabaseAdmin
    .from("shop_tiktok_channels")
    .select("*")
    .eq("id", channelId)
    .eq("shop_id", shopId)
    .maybeSingle();

  if (findError) throw new Error(findError.message);
  if (!channel) throw notFound("Không tìm thấy kênh TikTok.");

  const { error } = await supabaseAdmin
    .from("shop_tiktok_channels")
    .delete()
    .eq("id", channelId)
    .eq("shop_id", shopId);

  if (error) throw new Error(error.message);

  if (channel.is_default) {
    const channels = await listTikTokChannels(shopId);
    const nextDefault = channels[0] || null;

    if (nextDefault) {
      await updateTikTokChannel({ shopId, channelId: nextDefault.id, isDefault: true });
    } else {
      await updateShopDefaultTikTokUsername(shopId, null);
    }
  }

  return { success: true };
}

async function clearDefaultTikTokChannel(shopId: string) {
  const { error } = await supabaseAdmin
    .from("shop_tiktok_channels")
    .update({ is_default: false, updated_at: new Date().toISOString() })
    .eq("shop_id", shopId)
    .eq("is_default", true);

  if (error) throw new Error(error.message);
}

async function updateShopDefaultTikTokUsername(shopId: string, tiktokUsername: string | null) {
  const { error } = await supabaseAdmin
    .from("shops")
    .update({ default_tiktok_username: tiktokUsername, updated_at: new Date().toISOString() })
    .eq("id", shopId);

  if (error) throw new Error(error.message);
}
