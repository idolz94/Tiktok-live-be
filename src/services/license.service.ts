import { env } from "../config/env.js";
import { supabaseAdmin } from "../lib/supabase.js";
import { addDays } from "../utils/date.js";

export type LicenseReason =
  | null
  | "NO_USER"
  | "NO_SHOP"
  | "NO_LICENSE"
  | "TRIAL_EXPIRED"
  | "LICENSE_INACTIVE";

export function isLicenseUsable(license: any) {
  if (!license) return false;

  const validStatus = ["trial", "trialing", "active"].includes(String(license.status || ""));
  if (!validStatus) return false;

  const expiredAt = license.expired_at || license.trial_ends_at;
  if (!expiredAt) return true;

  const expiredTime = new Date(expiredAt).getTime();
  if (!Number.isFinite(expiredTime)) return false;

  return expiredTime > Date.now();
}

export function getLicenseState(license: any): { canUseApp: boolean; reason: LicenseReason } {
  if (!license) return { canUseApp: false, reason: "NO_LICENSE" };
  if (isLicenseUsable(license)) return { canUseApp: true, reason: null };

  const expiredAt = license.expired_at || license.trial_ends_at;
  if (expiredAt && new Date(expiredAt).getTime() < Date.now()) {
    return { canUseApp: false, reason: "TRIAL_EXPIRED" };
  }

  return { canUseApp: false, reason: "LICENSE_INACTIVE" };
}

export async function createTrialLicense(shopId: string) {
  const now = new Date();
  const trialEndsAt = addDays(now, env.trialDays).toISOString();

  const payload = {
    shop_id: shopId,
    plan_code: env.defaultPlanCode,
    status: "trial",
    started_at: now.toISOString(),
    expired_at: null,
    trial_ends_at: trialEndsAt,
    is_current: true,
    max_orders_per_month: null,
    max_live_sessions_per_month: null,
    max_members: null,
    max_tiktok_accounts: null,
    price: 0,
    currency: "VND",
    payment_status: "unpaid",
    last_payment_at: null,
    note: "Auto trial license",
  };

  const { data, error } = await supabaseAdmin
    .from("shop_licenses")
    .insert(payload)
    .select("*")
    .single();

  if (error) throw new Error(error.message);

  await supabaseAdmin
    .from("shops")
    .update({ license_status: "trialing", trial_ends_at: trialEndsAt, updated_at: now.toISOString() })
    .eq("id", shopId);

  return data;
}

export async function getCurrentLicense(shopId: string) {
  const { data, error } = await supabaseAdmin
    .from("shop_licenses")
    .select("*")
    .eq("shop_id", shopId)
    .eq("is_current", true)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data;
}

export async function activateLicenseFromPayment({
  shopId,
  planCode = "basic",
  months = 1,
  price = 0,
  paymentId = null,
}: {
  shopId: string;
  planCode?: string;
  months?: number;
  price?: number;
  paymentId?: string | null;
}) {
  const now = new Date();
  const expiredAt = addDays(now, Math.max(1, months) * 30).toISOString();

  await supabaseAdmin
    .from("shop_licenses")
    .update({ is_current: false, updated_at: now.toISOString() })
    .eq("shop_id", shopId)
    .eq("is_current", true);

  const { data, error } = await supabaseAdmin
    .from("shop_licenses")
    .insert({
      shop_id: shopId,
      plan_code: planCode,
      status: "active",
      started_at: now.toISOString(),
      expired_at: expiredAt,
      trial_ends_at: null,
      is_current: true,
      price,
      currency: "VND",
      payment_status: "paid",
      last_payment_at: now.toISOString(),
      note: paymentId ? `Activated by payment ${paymentId}` : "Manual activation",
    })
    .select("*")
    .single();

  if (error) throw new Error(error.message);

  await supabaseAdmin
    .from("shops")
    .update({ license_status: "active", trial_ends_at: null, updated_at: now.toISOString() })
    .eq("id", shopId);

  return data;
}
