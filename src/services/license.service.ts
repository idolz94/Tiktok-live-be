import { eq, and } from "drizzle-orm";
import { db } from "../lib/db.js";
import { shops, shopLicenses, licensePlans } from "../db/schema/index.js";
import { env } from "../config/env.js";
import { addDays } from "../utils/date.js";
import { seedLicensePlans } from "../db/seed-license-plans.js";

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
  const expiredAt = license.expiredAt ?? license.trialEndsAt;
  if (!expiredAt) return true;
  const expiredTime = new Date(expiredAt).getTime();
  if (!Number.isFinite(expiredTime)) return false;
  return expiredTime > Date.now();
}

export function getLicenseState(license: any): { canUseApp: boolean; reason: LicenseReason } {
  if (!license) return { canUseApp: false, reason: "NO_LICENSE" };
  if (isLicenseUsable(license)) return { canUseApp: true, reason: null };
  const expiredAt = license.expiredAt ?? license.trialEndsAt;
  if (expiredAt && new Date(expiredAt).getTime() < Date.now()) {
    return { canUseApp: false, reason: "TRIAL_EXPIRED" };
  }
  return { canUseApp: false, reason: "LICENSE_INACTIVE" };
}

export async function getCurrentLicense(shopId: string) {
  const rows = await db
    .select()
    .from(shopLicenses)
    .where(and(eq(shopLicenses.shopId, shopId), eq(shopLicenses.isCurrent, true)))
    .limit(1);
  return rows[0] ?? null;
}

async function ensureTrialPlan() {
  const existing = await db.select().from(licensePlans).where(eq(licensePlans.code, "trial")).limit(1);
  if (existing.length === 0) {
    await seedLicensePlans();
  }
}

export async function createTrialLicense(shopId: string) {
  await ensureTrialPlan();
  const now = new Date();
  const trialEndsAt = addDays(now, env.trialDays).toISOString();

  const [license] = await db
    .insert(shopLicenses)
    .values({
      shopId,
      planCode: "trial",
      status: "trial",
      startedAt: now,
      expiredAt: null,
      trialEndsAt: new Date(trialEndsAt),
      isCurrent: true,
      maxOrdersPerMonth: 200,
      maxLiveSessionsPerMonth: null,
      maxMembers: 1,
      maxTiktokAccounts: 1,
      price: 0,
      currency: "VND",
      paymentStatus: "unpaid",
      lastPaymentAt: null,
      note: "Auto trial license",
    })
    .returning();

  await db
    .update(shops)
    .set({ licenseStatus: "trialing", trialEndsAt: new Date(trialEndsAt), updatedAt: now })
    .where(eq(shops.id, shopId));

  return license;
}

export async function activateLicenseFromPayment({
  shopId,
  planCode = "basic",
  months = 1,
  price = 0,
  paymentId = null,
  activatedBy = null,
}: {
  shopId: string;
  planCode?: string;
  months?: number;
  price?: number;
  paymentId?: string | null;
  activatedBy?: string | null;
}) {
  const now = new Date();
  const expiredAt = addDays(now, Math.max(1, months) * 30);

  const [plan] = await db.select().from(licensePlans).where(eq(licensePlans.code, planCode)).limit(1);

  await db
    .update(shopLicenses)
    .set({ isCurrent: false, updatedAt: now })
    .where(and(eq(shopLicenses.shopId, shopId), eq(shopLicenses.isCurrent, true)));

  const [license] = await db
    .insert(shopLicenses)
    .values({
      shopId,
      planCode,
      status: "active",
      startedAt: now,
      expiredAt,
      trialEndsAt: null,
      isCurrent: true,
      maxOrdersPerMonth: plan?.maxOrdersPerMonth ?? null,
      maxLiveSessionsPerMonth: plan?.maxLiveSessionsPerMonth ?? null,
      maxMembers: plan?.maxMembers ?? null,
      maxTiktokAccounts: plan?.maxTiktokAccounts ?? null,
      price,
      currency: "VND",
      paymentStatus: "paid",
      lastPaymentAt: now,
      activatedBy: activatedBy ?? null,
      note: paymentId ? `Activated by payment ${paymentId}` : "Manual activation",
    })
    .returning();

  await db
    .update(shops)
    .set({ licenseStatus: "active", trialEndsAt: null, updatedAt: now })
    .where(eq(shops.id, shopId));

  return license;
}
