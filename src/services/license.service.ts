import { eq, and, or, lte } from "drizzle-orm";
import { db } from "../lib/db.js";
import { shops, shopLicenses, licensePlans, users, shopMembers } from "../db/schema/index.js";
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

export async function findShopByUsername(input: string): Promise<{ shopId: string; shopName: string; userId: string } | null> {
  const userRows = await db
    .select({ id: users.id })
    .from(users)
    .where(or(eq(users.username, input), eq(users.email, input), eq(users.phone, input)))
    .limit(1);

  if (!userRows[0]) return null;

  const memberRows = await db
    .select({ shopId: shopMembers.shopId })
    .from(shopMembers)
    .where(and(eq(shopMembers.userId, userRows[0].id), eq(shopMembers.status, "active")))
    .orderBy(shopMembers.createdAt)
    .limit(1);

  if (!memberRows[0]?.shopId) return null;

  const shopRows = await db
    .select({ id: shops.id, name: shops.name })
    .from(shops)
    .where(eq(shops.id, memberRows[0].shopId))
    .limit(1);

  if (!shopRows[0]) return null;

  return { shopId: shopRows[0].id, shopName: shopRows[0].name, userId: userRows[0].id };
}

export async function changeLicenseTier({ shopId, planCode }: { shopId: string; planCode: string }) {
  const now = new Date();

  const [plan] = await db.select().from(licensePlans).where(eq(licensePlans.code, planCode)).limit(1);

  const [license] = await db
    .update(shopLicenses)
    .set({
      planCode,
      maxOrdersPerMonth: plan?.maxOrdersPerMonth ?? null,
      maxLiveSessionsPerMonth: plan?.maxLiveSessionsPerMonth ?? null,
      maxMembers: plan?.maxMembers ?? null,
      maxTiktokAccounts: plan?.maxTiktokAccounts ?? null,
      updatedAt: now,
    })
    .where(and(eq(shopLicenses.shopId, shopId), eq(shopLicenses.isCurrent, true)))
    .returning();

  return license ?? null;
}

// Called by the expiry cron in server.ts — marks licenses past their expiredAt as inactive.
export async function expireOldLicenses(): Promise<number> {
  const now = new Date();
  const result = await db
    .update(shopLicenses)
    .set({ status: "inactive", updatedAt: now })
    .where(
      and(
        eq(shopLicenses.isCurrent, true),
        eq(shopLicenses.status, "active"),
        lte(shopLicenses.expiredAt, now),
      ),
    )
    .returning({ id: shopLicenses.id });
  return result.length;
}
