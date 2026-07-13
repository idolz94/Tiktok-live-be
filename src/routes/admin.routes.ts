import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler.js";
import { notFound } from "../lib/api-error.js";
import { ok, mutateOk } from "../lib/response.js";
import { requireAuth } from "../middlewares/auth.js";
import { requireAdmin, requireManager } from "../middlewares/require-role.js";
import { activateLicenseFromPayment, getCurrentLicense, changeLicenseTier } from "../services/license.service.js";
import { seedLicensePlans } from "../db/seed-license-plans.js";
import { changeUserPassword } from "../services/auth.service.js";
import { searchUsers, getUserDetail } from "../services/admin.service.js";

const router = Router();

// ─── License management (manager+) ────────────────────────────────────────────

const activateSchema = z.object({
  shopId: z.string().uuid(),
  planCode: z.enum(["trial", "basic", "pro", "vip"]).default("basic"),
  months: z.number().int().min(1).max(24).default(1),
  price: z.number().min(0).default(0),
  paymentId: z.string().optional().nullable(),
});

router.post(
  "/licenses/activate",
  requireAuth,
  requireManager,
  asyncHandler(async (request, response) => {
    const body = activateSchema.parse(request.body || {});
    const license = await activateLicenseFromPayment({
      shopId: body.shopId,
      planCode: body.planCode,
      months: body.months,
      price: body.price,
      paymentId: body.paymentId ?? null,
    });
    return ok(response, { license });
  }),
);

router.get(
  "/licenses/:shopId",
  requireAuth,
  requireManager,
  asyncHandler(async (request, response) => {
    const license = await getCurrentLicense(String(request.params.shopId));
    return ok(response, { license });
  }),
);

const tierSchema = z.object({
  planCode: z.enum(["trial", "basic", "pro", "vip"]),
});

router.patch(
  "/licenses/:shopId/tier",
  requireAuth,
  requireManager,
  asyncHandler(async (request, response) => {
    const shopId = String(request.params.shopId);
    const body = tierSchema.parse(request.body || {});
    const license = await changeLicenseTier({ shopId, planCode: body.planCode });
    return ok(response, { license });
  }),
);

// ─── User management (manager+) ───────────────────────────────────────────────

const changePasswordSchema = z.object({
  newPassword: z.string().min(6).max(128),
});

router.patch(
  "/users/:userId/password",
  requireAuth,
  requireManager,
  asyncHandler(async (request, response) => {
    const userId = String(request.params.userId);
    const body = changePasswordSchema.parse(request.body || {});
    await changeUserPassword(userId, body.newPassword);
    return mutateOk(response, "Đổi mật khẩu thành công.", null);
  }),
);

// ─── Platform management (admin only) ─────────────────────────────────────────

router.post(
  "/seed-plans",
  requireAuth,
  requireAdmin,
  asyncHandler(async (_request, response) => {
    await seedLicensePlans();
    return ok(response, { seeded: true });
  }),
);

// ─── User search & detail (manager+) ─────────────────────────────────────────

const searchUsersSchema = z.object({
  username: z.string().default(""),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

router.get(
  "/users",
  requireAuth,
  requireManager,
  asyncHandler(async (request, response) => {
    const query = searchUsersSchema.parse(request.query ?? {});
    const result = await searchUsers(query);
    return ok(response, result);
  }),
);

router.get(
  "/users/:userId",
  requireAuth,
  requireManager,
  asyncHandler(async (request, response) => {
    const userId = String(request.params.userId);
    const result = await getUserDetail(userId);
    if (!result) throw notFound("Không tìm thấy người dùng.");
    return ok(response, result);
  }),
);

export default router;
