import { Router } from "express";
import { z } from "zod";
import { eq, and, or } from "drizzle-orm";
import { asyncHandler } from "../lib/async-handler.js";
import { ok } from "../lib/response.js";
import { forbidden } from "../lib/api-error.js";
import { requireAuth } from "../middlewares/auth.js";
import { getAccountContext, requireAccountContext } from "../services/account.service.js";
import { getCurrentLicense, getLicenseState, activateLicenseFromPayment } from "../services/license.service.js";
import { env } from "../config/env.js";
import { db } from "../lib/db.js";
import { shops, shopMembers, users } from "../db/schema/index.js";

const router = Router();

router.get(
  "/current",
  requireAuth,
  asyncHandler(async (request, response) => {
    const context = await getAccountContext(request);
    return ok(response, {
      license: context.license,
      canUseApp: context.canUseApp,
      reason: context.reason,
    });
  }),
);

router.post(
  "/refresh",
  requireAuth,
  asyncHandler(async (request, response) => {
    const context = await requireAccountContext(request);
    const license = await getCurrentLicense(context.shop.id);
    const licenseState = getLicenseState(license);
    return ok(response, { license, ...licenseState });
  }),
);

const adminActivateSchema = z.object({
  username: z.string().min(1),
  planCode: z.enum(["trial", "basic", "pro", "vip"]).default("basic"),
  months: z.number().int().min(1).max(24).default(1),
  price: z.number().min(0).default(0),
});

// Admin-only: gia hạn license cho user khác — chỉ cho phép user có id = env.adminUserId
router.post(
  "/admin-activate",
  requireAuth,
  asyncHandler(async (request, response) => {
    if (!env.adminUserId || request.authUserId !== env.adminUserId) {
      throw forbidden("Không có quyền thực hiện thao tác này.");
    }

    const body = adminActivateSchema.parse(request.body || {});

    const input = body.username.trim().toLowerCase();

    // Tìm user theo username, email hoặc phone
    const userRows = await db
      .select({ id: users.id, fullName: users.fullName, email: users.email, phone: users.phone })
      .from(users)
      .where(
        or(
          eq(users.username, input),
          eq(users.email, input),
          eq(users.phone, input),
        ),
      )
      .limit(1);

    if (!userRows[0]) {
      throw forbidden(`Không tìm thấy user với username "${body.username}".`);
    }

    const user = userRows[0];

    // Tìm shop của user
    const memberRows = await db
      .select({ shopId: shopMembers.shopId })
      .from(shopMembers)
      .where(and(eq(shopMembers.userId, user.id), eq(shopMembers.status, "active")))
      .orderBy(shopMembers.createdAt)
      .limit(1);

    if (!memberRows[0]?.shopId) {
      throw forbidden(`User "${body.username}" chưa có shop.`);
    }

    const shopRows = await db
      .select({ id: shops.id, name: shops.name })
      .from(shops)
      .where(eq(shops.id, memberRows[0].shopId))
      .limit(1);

    if (!shopRows[0]) {
      throw forbidden(`Không tìm thấy shop cho user "${body.username}".`);
    }

    const shop = shopRows[0];

    const license = await activateLicenseFromPayment({
      shopId: shop.id,
      planCode: body.planCode,
      months: body.months,
      price: body.price,
      activatedBy: request.authUserId,
    });

    return ok(response, { license, shopId: shop.id, shopName: shop.name });
  }),
);

export default router;
