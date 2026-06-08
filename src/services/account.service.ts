import type { Request } from "express";
import { forbidden, unauthorized } from "../lib/api-error.js";
import { supabaseAdmin } from "../lib/supabase.js";
import { getCurrentLicense, getLicenseState } from "./license.service.js";

export type AccountContext = {
  user: NonNullable<Request["authUser"]>;
  profile: any | null;
  shopMember: any | null;
  shop: any | null;
  license: any | null;
  canUseApp: boolean;
  reason: string | null;
};

export async function getAccountContext(request: Request): Promise<AccountContext> {
  const user = request.authUser;
  if (!user) throw unauthorized();

  const [{ data: profile, error: profileError }, { data: shopMember, error: memberError }] =
    await Promise.all([
      supabaseAdmin.from("profiles").select("*").eq("id", user.id).maybeSingle(),
      supabaseAdmin
        .from("shop_members")
        .select("*")
        .eq("user_id", user.id)
        .eq("status", "active")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle(),
    ]);

  if (profileError) throw new Error(profileError.message);
  if (memberError) throw new Error(memberError.message);

  if (!shopMember?.shop_id) {
    return { user, profile, shopMember: null, shop: null, license: null, canUseApp: false, reason: "NO_SHOP" };
  }

  const { data: shop, error: shopError } = await supabaseAdmin
    .from("shops")
    .select("*")
    .eq("id", shopMember.shop_id)
    .maybeSingle();

  if (shopError) throw new Error(shopError.message);

  if (!shop) {
    return { user, profile, shopMember, shop: null, license: null, canUseApp: false, reason: "NO_SHOP" };
  }

  const license = await getCurrentLicense(shop.id);
  const licenseState = getLicenseState(license);

  return {
    user,
    profile,
    shopMember,
    shop,
    license,
    canUseApp: licenseState.canUseApp,
    reason: licenseState.reason,
  };
}

export async function requireShopId(request: Request): Promise<string> {
  const user = request.authUser;
  if (!user) throw unauthorized();

  const { data, error } = await supabaseAdmin
    .from("shop_members")
    .select("shop_id")
    .eq("user_id", user.id)
    .eq("status", "active")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data?.shop_id) throw forbidden("Không tìm thấy shop.");

  return data.shop_id;
}

export async function requireAccountContext(request: Request) {
  const context = await getAccountContext(request);
  if (!context.shop?.id) throw forbidden("Không tìm thấy shop.");
  return context;
}

export async function requireUsableAccountContext(request: Request) {
  const context = await requireAccountContext(request);
  if (!context.canUseApp) {
    throw forbidden("Shop đã hết hạn dùng thử hoặc chưa có license.");
  }
  return context;
}
