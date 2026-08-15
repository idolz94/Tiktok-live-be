import { and, desc, eq, ilike, inArray, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import { db } from "../lib/db.js";
import { refreshTokens, shopLicenses, shops, users } from "../db/schema/index.js";

// ─── Search users ─────────────────────────────────────────────────────────────

type AdminUserStatusFilter = "active" | "locked" | "archived";

type SearchUsersInput = {
  query?: string;
  username?: string;
  status?: AdminUserStatusFilter;
  role?: string;
  licensePlan?: string;
  licenseStatus?: string;
  page?: number;
  limit?: number;
};

function buildSearchUsersWhere({
  query,
  username,
  status,
  role,
  licensePlan,
  licenseStatus,
}: SearchUsersInput) {
  const conditions: SQL[] = [];
  const normalizedQuery = query?.trim() ?? "";
  const searchTerm = normalizedQuery.length > 0 ? normalizedQuery : (username ?? "").trim();

  if (searchTerm.length > 0) {
    const pattern = `%${searchTerm}%`;
    conditions.push(
      or(
        ilike(users.username, pattern),
        ilike(users.phone, pattern),
        ilike(users.email, pattern),
        ilike(users.fullName, pattern),
      )!,
    );
  }

  if (status === "archived") {
    conditions.push(isNotNull(users.deletedAt));
  } else {
    conditions.push(isNull(users.deletedAt));
    if (status) {
      conditions.push(eq(users.status, status));
    }
  }

  if (role) {
    conditions.push(eq(users.role, role));
  }

  if (licensePlan || licenseStatus) {
    conditions.push(sql`exists (
      select 1
      from ${shops}
      inner join ${shopLicenses} on ${shopLicenses.shopId} = ${shops.id}
      where ${shops.ownerId} = ${users.id}
        and ${shopLicenses.isCurrent} = true
        ${licensePlan ? sql`and ${shopLicenses.planCode} = ${licensePlan}` : sql``}
        ${licenseStatus ? sql`and ${shopLicenses.status} = ${licenseStatus}` : sql``}
    )`);
  }

  return and(...conditions);
}

export async function searchUsers({
  query,
  username,
  status,
  role,
  licensePlan,
  licenseStatus,
  page = 1,
  limit = 20,
}: SearchUsersInput) {
  const limitCapped = Math.min(limit, 100);
  const offset = (page - 1) * limitCapped;
  const where = buildSearchUsersWhere({
    query,
    username,
    status,
    role,
    licensePlan,
    licenseStatus,
  });

  // Count matching users using the same filters as the paginated list.
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(users)
    .where(where);

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
      role: users.role,
      status: users.status,
      deletedAt: users.deletedAt,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(where)
    .orderBy(desc(users.createdAt))
    .limit(limitCapped)
    .offset(offset);

  const userIds = userRows.map((u) => u.id);

  const licenseConditions: SQL[] = [];
  if (licensePlan) {
    licenseConditions.push(sql`exists (
      select 1
      from ${shopLicenses}
      where ${shopLicenses.shopId} = ${shops.id}
        and ${shopLicenses.isCurrent} = true
        and ${shopLicenses.planCode} = ${licensePlan}
    )`);
  }
  if (licenseStatus) {
    licenseConditions.push(sql`exists (
      select 1
      from ${shopLicenses}
      where ${shopLicenses.shopId} = ${shops.id}
        and ${shopLicenses.isCurrent} = true
        and ${shopLicenses.status} = ${licenseStatus}
    )`);
  }

  // Bulk-fetch owned shops. When license filters are applied, hydrate a shop
  // whose current license satisfies the same filter so displayed rows match it.
  const shopRows = userIds.length > 0
    ? await db
        .select({
          id: shops.id,
          ownerId: shops.ownerId,
          name: shops.name,
          licenseStatus: shops.licenseStatus,
          trialEndsAt: shops.trialEndsAt,
        })
        .from(shops)
        .where(and(inArray(shops.ownerId, userIds), ...licenseConditions))
    : [];

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
      role: u.role,
      status: u.status,
      deletedAt: u.deletedAt,
      isArchived: u.deletedAt !== null,
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

export async function updateUserStatus(userId: string, status: "active" | "locked") {
  // Fetch current user status for before/after snapshot
  const [currentUser] = await db
    .select({ status: users.status })
    .from(users)
    .where(eq(users.id, userId));

  if (!currentUser) return null;

  const beforeStatus = currentUser.status;

  const [user] = await db
    .update(users)
    .set({ status, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning({
      id: users.id,
      username: users.username,
      email: users.email,
      phone: users.phone,
      fullName: users.fullName,
      status: users.status,
      createdAt: users.createdAt,
    });

  if (user && status === "locked") {
    await db.delete(refreshTokens).where(eq(refreshTokens.userId, userId));
  }

  return { user, beforeStatus };
}

export async function getUserDetail(userId: string) {
  const [user] = await db
    .select({
      id: users.id,
      username: users.username,
      email: users.email,
      phone: users.phone,
      fullName: users.fullName,
      role: users.role,
      status: users.status,
      deletedAt: users.deletedAt,
      createdAt: users.createdAt,
      overrides: users.overrides,
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
    user: {
      ...user,
      isArchived: user.deletedAt !== null,
    },
    shop: shop ?? null,
    license,
  };
}

// ─── User role change ────────────────────────────────────────────────────────

export async function updateUserRole(userId: string, role: "user" | "manager" | "admin") {
  // Fetch current role for before/after snapshot
  const [currentUser] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId));

  if (!currentUser) return null;

  const beforeRole = currentUser.role;

  const [user] = await db
    .update(users)
    .set({ role, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning({
      id: users.id,
      username: users.username,
      email: users.email,
      phone: users.phone,
      fullName: users.fullName,
      role: users.role,
      status: users.status,
      createdAt: users.createdAt,
    });

  return { user, beforeRole };
}

// ─── User archive (soft delete) ──────────────────────────────────────────────

export async function archiveUser(userId: string) {
  // Fetch current user for before/after snapshot
  const [currentUser] = await db
    .select({
      id: users.id,
      deletedAt: users.deletedAt,
    })
    .from(users)
    .where(eq(users.id, userId));

  if (!currentUser) return null;

  const beforeArchived = currentUser.deletedAt !== null;

  const now = new Date();
  const [user] = await db
    .update(users)
    .set({ deletedAt: now, updatedAt: now })
    .where(eq(users.id, userId))
    .returning({
      id: users.id,
      username: users.username,
      email: users.email,
      phone: users.phone,
      fullName: users.fullName,
      role: users.role,
      status: users.status,
      deletedAt: users.deletedAt,
      createdAt: users.createdAt,
    });

  // Revoke all refresh tokens for the archived user
  if (user) {
    await db.delete(refreshTokens).where(eq(refreshTokens.userId, userId));
  }

  return { user, beforeArchived };
}

// ─── Per-user overrides ──────────────────────────────────────────────────────

export const OVERRIDE_FEATURE_KEYS = [
  "canPrint",
  "canExportExcel",
  "canUseReports",
  "canUseShipping",
] as const;

export type OverrideFeatureKey = (typeof OVERRIDE_FEATURE_KEYS)[number];

export interface OverrideEntry {
  value: number | boolean;
  setBy: string;
  setByUsername: string | null;
  setAt: string;
}

export interface UserOverrides {
  maxDevices?: OverrideEntry | null;
  features?: Partial<Record<OverrideFeatureKey, OverrideEntry | null>> | null;
}

export async function updateUserOverrides(
  userId: string,
  input: {
    maxDevices?: number | null;
    features?: Partial<Record<OverrideFeatureKey, boolean | null>>;
  },
  adminUserId: string,
) {
  const [user] = await db
    .select({ id: users.id, overrides: users.overrides })
    .from(users)
    .where(eq(users.id, userId));

  if (!user) return null;

  // Resolve the acting admin's username for denormalized display.
  const [adminRow] = await db
    .select({ username: users.username })
    .from(users)
    .where(eq(users.id, adminUserId))
    .limit(1);
  const setByUsername = adminRow?.username ?? null;
  const setAt = new Date().toISOString();

  const current = (user.overrides ?? {}) as UserOverrides;
  const next: UserOverrides = {
    ...current,
    features: { ...(current.features ?? {}) },
  };

  if ("maxDevices" in input) {
    if (input.maxDevices == null) {
      delete next.maxDevices;
    } else {
      next.maxDevices = { value: input.maxDevices, setBy: adminUserId, setByUsername, setAt };
    }
  }

  if (input.features) {
    for (const key of Object.keys(input.features) as OverrideFeatureKey[]) {
      const value = input.features[key];
      if (value == null) {
        delete next.features?.[key];
      } else {
        next.features![key] = { value, setBy: adminUserId, setByUsername, setAt };
      }
    }
  }

  const [updated] = await db
    .update(users)
    .set({ overrides: next, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning();

  return { user: updated, before: user.overrides, after: next };
}
