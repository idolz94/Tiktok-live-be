import { and, desc, eq, ilike, inArray, sql } from "drizzle-orm";
import { db } from "../lib/db.js";
import { shopLicenses, shops, users } from "../db/schema/index.js";

// ─── Search users ─────────────────────────────────────────────────────────────

export async function searchUsers({
  username,
  page = 1,
  limit = 20,
}: {
  username: string;
  page?: number;
  limit?: number;
}) {
  const limitCapped = Math.min(limit, 100);
  const offset = (page - 1) * limitCapped;
  const pattern = `%${username.trim()}%`;

  // Count matching users
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(users)
    .where(ilike(users.username, pattern));

  if (total === 0) {
    return { users: [], total: 0, page, limit: limitCapped };
  }

  // Paginated user list
  const userRows = await db
    .select({
      id: users.id,
      username: users.username,
      email: users.email,
      phone: users.phone,
      fullName: users.fullName,
      status: users.status,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(ilike(users.username, pattern))
    .orderBy(desc(users.createdAt))
    .limit(limitCapped)
    .offset(offset);

  const userIds = userRows.map((u) => u.id);

  // Bulk-fetch owned shops
  const shopRows = await db
    .select({
      id: shops.id,
      ownerId: shops.ownerId,
      name: shops.name,
      licenseStatus: shops.licenseStatus,
      trialEndsAt: shops.trialEndsAt,
    })
    .from(shops)
    .where(inArray(shops.ownerId, userIds));

  // One shop per owner (take first if somehow multiple)
  const shopByOwner = new Map<string, (typeof shopRows)[number]>();
  for (const s of shopRows) {
    if (!shopByOwner.has(s.ownerId)) shopByOwner.set(s.ownerId, s);
  }

  // Bulk-fetch current licenses
  const shopIds = shopRows.map((s) => s.id);
  const licenseByShop = new Map<string, { planCode: string; status: string; expiredAt: Date | null }>();

  if (shopIds.length > 0) {
    const licenseRows = await db
      .select({
        shopId: shopLicenses.shopId,
        planCode: shopLicenses.planCode,
        status: shopLicenses.status,
        expiredAt: shopLicenses.expiredAt,
      })
      .from(shopLicenses)
      .where(
        and(inArray(shopLicenses.shopId, shopIds), eq(shopLicenses.isCurrent, true)),
      );

    for (const l of licenseRows) {
      licenseByShop.set(l.shopId, { planCode: l.planCode, status: l.status, expiredAt: l.expiredAt });
    }
  }

  // Assemble response
  const result = userRows.map((u) => {
    const shop = shopByOwner.get(u.id) ?? null;
    const license = shop ? (licenseByShop.get(shop.id) ?? null) : null;

    return {
      id: u.id,
      username: u.username,
      email: u.email,
      phone: u.phone,
      fullName: u.fullName,
      status: u.status,
      createdAt: u.createdAt,
      shop: shop
        ? {
            id: shop.id,
            name: shop.name,
            licenseStatus: shop.licenseStatus,
            trialEndsAt: shop.trialEndsAt,
          }
        : null,
      license: license
        ? {
            planCode: license.planCode,
            status: license.status,
            expiredAt: license.expiredAt,
          }
        : null,
    };
  });

  return { users: result, total, page, limit: limitCapped };
}

// ─── User detail ──────────────────────────────────────────────────────────────

export async function getUserDetail(userId: string) {
  const [user] = await db
    .select({
      id: users.id,
      username: users.username,
      email: users.email,
      phone: users.phone,
      fullName: users.fullName,
      status: users.status,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, userId));

  if (!user) return null;

  const [shop] = await db
    .select({
      id: shops.id,
      name: shops.name,
      licenseStatus: shops.licenseStatus,
      trialEndsAt: shops.trialEndsAt,
    })
    .from(shops)
    .where(eq(shops.ownerId, userId));

  let license = null;
  if (shop) {
    const [lic] = await db
      .select({
        id: shopLicenses.id,
        planCode: shopLicenses.planCode,
        status: shopLicenses.status,
        startedAt: shopLicenses.startedAt,
        expiredAt: shopLicenses.expiredAt,
        trialEndsAt: shopLicenses.trialEndsAt,
        maxOrdersPerMonth: shopLicenses.maxOrdersPerMonth,
        maxMembers: shopLicenses.maxMembers,
        maxTiktokAccounts: shopLicenses.maxTiktokAccounts,
        price: shopLicenses.price,
        currency: shopLicenses.currency,
        paymentStatus: shopLicenses.paymentStatus,
      })
      .from(shopLicenses)
      .where(
        and(eq(shopLicenses.shopId, shop.id), eq(shopLicenses.isCurrent, true)),
      );

    license = lic ?? null;
  }

  return {
    user,
    shop: shop ?? null,
    license,
  };
}
