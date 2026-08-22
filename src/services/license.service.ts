import { eq, and, or, lte, gt, gte, lt, ilike, isNotNull, count, asc, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { db, type DbOrTx } from "../lib/db.js";
import { shops, shopLicenses, licensePlans, users, shopMembers, orders, liveSessions, tiktokChannels } from "../db/schema/index.js";
import { env } from "../config/env.js";
import { badRequest } from "../lib/api-error.js";
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

export async function createTrialLicense(shopId: string, tx: DbOrTx = db) {
  await ensureTrialPlan();
  const now = new Date();
  const trialEndsAt = addDays(now, env.trialDays).toISOString();

  // Use defaults from the trial plan so limits stay in sync with admin config
  const [trialPlan] = await db.select().from(licensePlans).where(eq(licensePlans.code, "trial")).limit(1);

  const [license] = await tx
    .insert(shopLicenses)
    .values({
      shopId,
      planCode: "trial",
      status: "trial",
      startedAt: now,
      expiredAt: null,
      trialEndsAt: new Date(trialEndsAt),
      isCurrent: true,
      maxOrdersPerMonth: trialPlan?.maxOrdersPerMonth ?? 200,
      maxLiveSessionsPerMonth: trialPlan?.maxLiveSessionsPerMonth ?? null,
      maxMembers: trialPlan?.maxMembers ?? 1,
      maxTiktokAccounts: trialPlan?.maxTiktokAccounts ?? 1,
      price: 0,
      currency: "VND",
      paymentStatus: "unpaid",
      lastPaymentAt: null,
      note: "Auto trial license",
    })
    .returning();

  await tx
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

// ─── Admin: license plan lookup ──────────────────────────────────────────────

export async function getLicensePlan(code: string) {
  const [plan] = await db
    .select()
    .from(licensePlans)
    .where(eq(licensePlans.code, code))
    .limit(1);
  return plan ?? null;
}

// ─── Admin: license detail (shop + current license + plan defaults) ──────────

export async function getLicenseAdminDetail(shopId: string) {
  const [shop] = await db
    .select({ id: shops.id, name: shops.name, licenseStatus: shops.licenseStatus })
    .from(shops)
    .where(eq(shops.id, shopId))
    .limit(1);
  if (!shop) return null;

  const license = await getCurrentLicense(shopId);
  const planDefaults = license ? await getLicensePlan(license.planCode) : null;

  return { shop, license, planDefaults };
}

// ─── Admin: cross-shop license search ────────────────────────────────────────

export type LicenseSortBy = "expiredAt" | "shopName";

export async function searchLicenses({
  query,
  plan,
  status,
  expiringSoon = false,
  sortBy = "expiredAt",
  page = 1,
  limit = 20,
}: {
  query?: string;
  plan?: string;
  status?: string;
  expiringSoon?: boolean;
  sortBy?: LicenseSortBy;
  page?: number;
  limit?: number;
}) {
  const limitCapped = Math.min(limit, 100);
  const offset = (page - 1) * limitCapped;
  const now = new Date();

  const conditions: SQL[] = [eq(shopLicenses.isCurrent, true)];
  if (plan) conditions.push(eq(shopLicenses.planCode, plan));
  if (status) conditions.push(eq(shopLicenses.status, status));
  if (expiringSoon) {
    conditions.push(isNotNull(shopLicenses.expiredAt));
    conditions.push(gt(shopLicenses.expiredAt, now));
    conditions.push(lte(shopLicenses.expiredAt, addDays(now, 7)));
  }
  const q = query?.trim();
  if (q) {
    conditions.push(or(ilike(shops.name, `%${q}%`), ilike(users.username, `%${q}%`))!);
  }
  const where = and(...conditions);

  const [{ total }] = await db
    .select({ total: count() })
    .from(shopLicenses)
    .innerJoin(shops, eq(shopLicenses.shopId, shops.id))
    .leftJoin(users, eq(shops.ownerId, users.id))
    .where(where);

  if (total === 0) {
    return { items: [], total: 0, page, limit: limitCapped };
  }

  const rows = await db
    .select({
      licenseId: shopLicenses.id,
      planCode: shopLicenses.planCode,
      status: shopLicenses.status,
      startedAt: shopLicenses.startedAt,
      expiredAt: shopLicenses.expiredAt,
      trialEndsAt: shopLicenses.trialEndsAt,
      shopId: shops.id,
      shopName: shops.name,
      ownerUsername: users.username,
    })
    .from(shopLicenses)
    .innerJoin(shops, eq(shopLicenses.shopId, shops.id))
    .leftJoin(users, eq(shops.ownerId, users.id))
    .where(where)
    .orderBy(sortBy === "shopName" ? asc(shops.name) : asc(shopLicenses.expiredAt))
    .limit(limitCapped)
    .offset(offset);

  const items = rows.map((row) => {
    const expiry = row.expiredAt ?? row.trialEndsAt;
    return {
      ...row,
      daysRemaining: expiry
        ? Math.ceil((new Date(expiry).getTime() - now.getTime()) / 86_400_000)
        : null,
    };
  });

  return { items, total, page, limit: limitCapped };
}

// ─── Admin: extend / limits ──────────────────────────────────────────────────

export const LICENSE_LIMIT_FIELDS = [
  "maxOrdersPerMonth",
  "maxLiveSessionsPerMonth",
  "maxMembers",
  "maxTiktokAccounts",
] as const;

export type LicenseLimitField = (typeof LICENSE_LIMIT_FIELDS)[number];

export async function extendLicense({ shopId, months }: { shopId: string; months: number }) {
  const now = new Date();
  const license = await getCurrentLicense(shopId);
  if (!license) return null;

  const base = license.expiredAt ?? license.trialEndsAt;
  const from = base && new Date(base).getTime() > now.getTime() ? new Date(base) : now;
  const newExpiredAt = addDays(from, Math.max(1, months) * 30);

  const [updated] = await db
    .update(shopLicenses)
    .set({ expiredAt: newExpiredAt, status: "active", trialEndsAt: null, updatedAt: now })
    .where(eq(shopLicenses.id, license.id))
    .returning();

  return { license: updated, beforeExpiredAt: license.expiredAt };
}

export async function updateLicenseLimits({
  shopId,
  limits,
}: {
  shopId: string;
  limits: Partial<Record<LicenseLimitField, number | null>>;
}) {
  const license = await getCurrentLicense(shopId);
  if (!license) return null;

  const set: Record<string, unknown> = { updatedAt: new Date() };
  for (const field of LICENSE_LIMIT_FIELDS) {
    if (field in limits) set[field] = limits[field] ?? null;
  }

  const [updated] = await db
    .update(shopLicenses)
    .set(set)
    .where(eq(shopLicenses.id, license.id))
    .returning();

  const pick = (l: typeof license) =>
    Object.fromEntries(LICENSE_LIMIT_FIELDS.map((f) => [f, l[f]]));

  return { license: updated, before: pick(license), after: pick(updated) };
}

// ─── Enforcement helpers (throw 400 when limit exceeded) ─────────────────────

export async function assertLiveSessionLimitNotExceeded(shopId: string): Promise<void> {
  const license = await getCurrentLicense(shopId);
  const limit = license?.maxLiveSessionsPerMonth ?? null;
  if (limit === null) return;
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(liveSessions)
    .where(and(eq(liveSessions.shopId, shopId), gte(liveSessions.startedAt, monthStart), lt(liveSessions.startedAt, monthEnd)));
  const used = row?.count ?? 0;
  if (used >= limit) {
    throw badRequest(`Shop đã tạo ${used}/${limit} phiên live trong tháng này. Vui lòng nâng cấp gói để tiếp tục.`);
  }
}

export async function assertMemberLimitNotExceeded(shopId: string): Promise<void> {
  const license = await getCurrentLicense(shopId);
  const limit = license?.maxMembers ?? null;
  if (limit === null) return;
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(shopMembers)
    .where(and(eq(shopMembers.shopId, shopId), eq(shopMembers.status, "active")));
  const used = row?.count ?? 0;
  if (used >= limit) {
    throw badRequest(`Shop đã có ${used}/${limit} thành viên. Vui lòng nâng cấp gói để thêm thành viên.`);
  }
}

export async function assertTiktokAccountLimitNotExceeded(shopId: string): Promise<void> {
  const license = await getCurrentLicense(shopId);
  const limit = license?.maxTiktokAccounts ?? null;
  if (limit === null) return;
  const [row] = await db
    .select({ count: sql<number>`count(distinct ${tiktokChannels.tiktokUsername})::int` })
    .from(tiktokChannels)
    .where(eq(tiktokChannels.shopId, shopId));
  const used = row?.count ?? 0;
  if (used >= limit) {
    throw badRequest(`Shop đã có ${used}/${limit} tài khoản TikTok. Vui lòng nâng cấp gói để thêm tài khoản.`);
  }
}

// ─── Admin: usage this month ─────────────────────────────────────────────────

export async function getLicenseUsage(shopId: string) {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);

  const license = await getCurrentLicense(shopId);

  const [{ orderCount }] = await db
    .select({ orderCount: count() })
    .from(orders)
    .where(and(eq(orders.shopId, shopId), gt(orders.createdAt, from)));

  const [{ sessionCount }] = await db
    .select({ sessionCount: count() })
    .from(liveSessions)
    .where(and(eq(liveSessions.shopId, shopId), gt(liveSessions.startedAt, from)));

  const [{ memberCount }] = await db
    .select({ memberCount: count() })
    .from(shopMembers)
    .where(and(eq(shopMembers.shopId, shopId), eq(shopMembers.status, "active")));

  const [{ accountCount }] = await db
    .select({ accountCount: sql<number>`count(distinct ${tiktokChannels.tiktokUsername})::int` })
    .from(tiktokChannels)
    .where(eq(tiktokChannels.shopId, shopId));

  return {
    period: { from, to: now },
    orders: { used: orderCount, max: license?.maxOrdersPerMonth ?? null },
    liveSessions: { used: sessionCount, max: license?.maxLiveSessionsPerMonth ?? null },
    members: { used: memberCount, max: license?.maxMembers ?? null },
    tiktokAccounts: { used: accountCount, max: license?.maxTiktokAccounts ?? null },
  };
}
