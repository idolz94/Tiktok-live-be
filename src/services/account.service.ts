import type { Request } from "express";
import { eq, and } from "drizzle-orm";
import { db } from "../lib/db.js";
import { profiles, shops, shopMembers } from "../db/schema/index.js";
import { forbidden, unauthorized } from "../lib/api-error.js";
import { createTrialLicense, getCurrentLicense, getLicenseState } from "./license.service.js";

export type AccountContext = {
  userId: string;
  profile: any | null;
  shopMember: any | null;
  shop: any | null;
  license: any | null;
  canUseApp: boolean;
  reason: string | null;
};

export async function getAccountContext(request: Request): Promise<AccountContext> {
  const userId = request.authUserId;
  if (!userId) throw unauthorized();

  const [profileRows, memberRows] = await Promise.all([
    db.select().from(profiles).where(eq(profiles.id, userId)).limit(1),
    db
      .select()
      .from(shopMembers)
      .where(and(eq(shopMembers.userId, userId), eq(shopMembers.status, "active")))
      .orderBy(shopMembers.createdAt)
      .limit(1),
  ]);

  const profile = profileRows[0] ?? null;
  const shopMember = memberRows[0] ?? null;

  if (!shopMember?.shopId) {
    return { userId, profile, shopMember: null, shop: null, license: null, canUseApp: false, reason: "NO_SHOP" };
  }

  const shopRows = await db.select().from(shops).where(eq(shops.id, shopMember.shopId)).limit(1);
  const shop = shopRows[0] ?? null;

  if (!shop) {
    return { userId, profile, shopMember, shop: null, license: null, canUseApp: false, reason: "NO_SHOP" };
  }

  const license = await getCurrentLicense(shop.id);
  const licenseState = getLicenseState(license);

  return {
    userId,
    profile,
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

  const [profileRows, memberRows] = await Promise.all([
    db.select().from(profiles).where(eq(profiles.id, userId)).limit(1),
    db
      .select()
      .from(shopMembers)
      .where(and(eq(shopMembers.userId, userId), eq(shopMembers.status, "active")))
      .orderBy(shopMembers.createdAt)
      .limit(1),
  ]);

  let profile = profileRows[0] ?? null;
  let shopMember = memberRows[0] ?? null;

  // Auto-provision profile if missing
  if (!profile) {
    const [created] = await db
      .insert(profiles)
      .values({ id: userId, fullName: null, email: null, phone: null })
      .onConflictDoNothing()
      .returning();
    profile = created ?? (await db.select().from(profiles).where(eq(profiles.id, userId)).limit(1))[0] ?? null;
  }

  // Auto-provision shop + membership if missing
  if (!shopMember?.shopId) {
    const [newShop] = await db
      .insert(shops)
      .values({ ownerId: userId, name: "Shop mới" })
      .returning();

    const [newMember] = await db
      .insert(shopMembers)
      .values({ shopId: newShop.id, userId, role: "owner", status: "active" })
      .returning();

    shopMember = newMember;

    // Auto-create trial license
    await createTrialLicense(newShop.id);
  }

  // Re-fetch full context now that provisioning is done
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
