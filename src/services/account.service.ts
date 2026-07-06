import type { Request } from "express";
import { eq, and } from "drizzle-orm";
import { db } from "../lib/db.js";
import { users, shops, shopMembers, orders, liveSessions } from "../db/schema/index.js";
import { forbidden, unauthorized } from "../lib/api-error.js";
import { createTrialLicense, getCurrentLicense, getLicenseState } from "./license.service.js";

export type AccountContext = {
  userId: string;
  user: any | null;
  shopMember: any | null;
  shop: any | null;
  license: any | null;
  canUseApp: boolean;
  reason: string | null;
};

export async function getAccountContext(request: Request): Promise<AccountContext> {
  const userId = request.authUserId;
  if (!userId) throw unauthorized();

  const [userRows, memberRows] = await Promise.all([
    db.select().from(users).where(eq(users.id, userId)).limit(1),
    db
      .select()
      .from(shopMembers)
      .where(and(eq(shopMembers.userId, userId), eq(shopMembers.status, "active")))
      .orderBy(shopMembers.createdAt)
      .limit(1),
  ]);

  const user = userRows[0] ?? null;
  const shopMember = memberRows[0] ?? null;

  if (!shopMember?.shopId) {
    return { userId, user, shopMember: null, shop: null, license: null, canUseApp: false, reason: "NO_SHOP" };
  }

  const shopRows = await db.select().from(shops).where(eq(shops.id, shopMember.shopId)).limit(1);
  const shop = shopRows[0] ?? null;

  if (!shop) {
    return { userId, user, shopMember, shop: null, license: null, canUseApp: false, reason: "NO_SHOP" };
  }

  const license = await getCurrentLicense(shop.id);
  const licenseState = getLicenseState(license);

  return {
    userId,
    user,
    shopMember,
    shop,
    license,
    canUseApp: licenseState.canUseApp,
    reason: licenseState.reason,
  };
}

export async function bootstrapAccountContext(request: Request): Promise<AccountContext> {
  const userId = request.authUserId;
  if (!userId) throw unauthorized();

  const [userRows, memberRows] = await Promise.all([
    db.select().from(users).where(eq(users.id, userId)).limit(1),
    db
      .select()
      .from(shopMembers)
      .where(and(eq(shopMembers.userId, userId), eq(shopMembers.status, "active")))
      .orderBy(shopMembers.createdAt)
      .limit(1),
  ]);

  const user = userRows[0] ?? null;
  const shopMember = memberRows[0] ?? null;

  // Auto-provision shop + membership if missing
  if (!shopMember?.shopId && user) {
    await db.transaction(async (tx) => {
      const [newShop] = await tx
        .insert(shops)
        .values({ ownerId: userId, name: "Shop mới" })
        .returning();

      await tx
        .insert(shopMembers)
        .values({ shopId: newShop.id, userId, role: "owner", status: "active" });

      await createTrialLicense(newShop.id, tx);
    });
    return getAccountContext(request);
  }

  return getAccountContext(request);
}

export async function requireShopId(request: Request): Promise<string> {
  const userId = request.authUserId;
  if (!userId) throw unauthorized();

  const rows = await db
    .select({ shopId: shopMembers.shopId })
    .from(shopMembers)
    .where(and(eq(shopMembers.userId, userId), eq(shopMembers.status, "active")))
    .orderBy(shopMembers.createdAt)
    .limit(1);

  const shopId = rows[0]?.shopId;
  if (!shopId) throw forbidden("Không tìm thấy shop.");

  return shopId;
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

export async function getShopActivityFlags(shopId: string): Promise<{ hasOrders: boolean; hasHistory: boolean }> {
  const [orderRow, historyRow] = await Promise.all([
    db.select({ id: orders.id }).from(orders).where(eq(orders.shopId, shopId)).limit(1),
    db.select({ id: liveSessions.id }).from(liveSessions).where(eq(liveSessions.shopId, shopId)).limit(1),
  ]);
  return { hasOrders: orderRow.length > 0, hasHistory: historyRow.length > 0 };
}
