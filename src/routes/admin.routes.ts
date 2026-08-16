import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler.js";
import { badRequest, notFound } from "../lib/api-error.js";
import { ok } from "../lib/response.js";
import { requireAuth } from "../middlewares/auth.js";
import { requireAdmin, requireManager } from "../middlewares/require-role.js";
import { activateLicenseFromPayment, getCurrentLicense, changeLicenseTier, searchLicenses, extendLicense, updateLicenseLimits, getLicenseUsage, getLicenseAdminDetail } from "../services/license.service.js";
import { seedLicensePlans } from "../db/seed-license-plans.js";
import { changeUserPassword } from "../services/auth.service.js";
import { searchUsers, getUserDetail, updateUserStatus, updateUserRole, archiveUser, updateUserOverrides, OVERRIDE_FEATURE_KEYS } from "../services/admin.service.js";
import { createAuditLog, getUserAuditLogs, getTargetAuditLogs } from "../services/admin-audit.service.js";

const router = Router();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getRequestIp(request: { ip?: string; headers: Record<string, string | string[] | undefined> }): string | null {
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return forwarded[0].trim();
  }
  return request.ip ?? null;
}

function getRequestUserAgent(request: { headers: Record<string, string | string[] | undefined> }): string | null {
  const ua = request.headers["user-agent"];
  if (typeof ua === "string") return ua || null;
  if (Array.isArray(ua) && ua.length > 0) return ua[0] || null;
  return null;
}

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

    await createAuditLog({
      adminUserId: request.authUserId!,
      action: "LICENSE_ACTIVATED",
      targetType: "license",
      targetId: license.id,
      before: null,
      after: { planCode: license.planCode, status: license.status, expiredAt: license.expiredAt },
      metadata: { months: body.months, price: body.price, paymentId: body.paymentId ?? null },
      ip: getRequestIp(request),
      userAgent: getRequestUserAgent(request),
    });

    return ok(response, { license });
  }),
);

router.get(
  "/licenses/:shopId",
  requireAuth,
  requireManager,
  asyncHandler(async (request, response) => {
    const shopId = String(request.params.shopId);
    const result = await getLicenseAdminDetail(shopId);
    if (!result) throw notFound("Không tìm thấy cửa hàng.");
    return ok(response, result);
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
    const beforeLicense = await getCurrentLicense(shopId);
    const license = await changeLicenseTier({ shopId, planCode: body.planCode });
    if (!license) throw notFound("Không tìm thấy license hiện tại của cửa hàng.");

    await createAuditLog({
      adminUserId: request.authUserId!,
      action: "LICENSE_TIER_CHANGED",
      targetType: "license",
      targetId: license.id,
      before: { planCode: beforeLicense?.planCode ?? null },
      after: { planCode: license.planCode },
      ip: getRequestIp(request),
      userAgent: getRequestUserAgent(request),
    });

    return ok(response, { license });
  }),
);

// ─── License list cross-shop (manager+) ──────────────────────────────────────

const listLicensesSchema = z.object({
  query: z.string().default(""),
  plan: z.enum(["trial", "basic", "pro", "vip"]).optional(),
  status: z.string().trim().min(1).optional(),
  expiringSoon: z.enum(["true", "1"]).optional(),
  sortBy: z.enum(["expiredAt", "shopName"]).default("expiredAt"),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

router.get(
  "/licenses",
  requireAuth,
  requireManager,
  asyncHandler(async (request, response) => {
    const query = listLicensesSchema.parse(request.query ?? {});
    const result = await searchLicenses({
      query: query.query,
      plan: query.plan,
      status: query.status,
      expiringSoon: query.expiringSoon !== undefined,
      sortBy: query.sortBy,
      page: query.page,
      limit: query.limit,
    });
    return ok(response, result);
  }),
);

// ─── License extend (manager+) ───────────────────────────────────────────────

const extendLicenseSchema = z.object({
  months: z.number().int().min(1).max(60),
});

router.patch(
  "/licenses/:shopId/extend",
  requireAuth,
  requireManager,
  asyncHandler(async (request, response) => {
    const shopId = String(request.params.shopId);
    const body = extendLicenseSchema.parse(request.body || {});
    const result = await extendLicense({ shopId, months: body.months });
    if (!result) throw notFound("Không tìm thấy license hiện tại của cửa hàng.");

    const { license, beforeExpiredAt } = result;

    await createAuditLog({
      adminUserId: request.authUserId!,
      action: "LICENSE_EXTENDED",
      targetType: "license",
      targetId: license.id,
      before: { expiredAt: beforeExpiredAt },
      after: { expiredAt: license.expiredAt },
      metadata: { months: body.months },
      ip: getRequestIp(request),
      userAgent: getRequestUserAgent(request),
    });

    return ok(response, { license });
  }),
);

// ─── License limits override (manager+) ──────────────────────────────────────

const limitsSchema = z
  .object({
    maxOrdersPerMonth: z.number().int().min(0).nullable().optional(),
    maxLiveSessionsPerMonth: z.number().int().min(0).nullable().optional(),
    maxMembers: z.number().int().min(0).nullable().optional(),
    maxTiktokAccounts: z.number().int().min(0).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "Cần truyền ít nhất một limit.");

router.patch(
  "/licenses/:shopId/limits",
  requireAuth,
  requireManager,
  asyncHandler(async (request, response) => {
    const shopId = String(request.params.shopId);
    const body = limitsSchema.parse(request.body || {});
    const result = await updateLicenseLimits({ shopId, limits: body });
    if (!result) throw notFound("Không tìm thấy license hiện tại của cửa hàng.");

    const { license, before, after } = result;

    await createAuditLog({
      adminUserId: request.authUserId!,
      action: "LICENSE_LIMITS_CHANGED",
      targetType: "license",
      targetId: license.id,
      before,
      after,
      ip: getRequestIp(request),
      userAgent: getRequestUserAgent(request),
    });

    return ok(response, { license });
  }),
);

// ─── License usage (manager+) ────────────────────────────────────────────────

router.get(
  "/licenses/:shopId/usage",
  requireAuth,
  requireManager,
  asyncHandler(async (request, response) => {
    const usage = await getLicenseUsage(String(request.params.shopId));
    return ok(response, usage);
  }),
);

// ─── License history (manager+) ──────────────────────────────────────────────

const licenseHistorySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

router.get(
  "/licenses/:shopId/history",
  requireAuth,
  requireManager,
  asyncHandler(async (request, response) => {
    const shopId = String(request.params.shopId);
    const license = await getCurrentLicense(shopId);
    if (!license) throw notFound("Không tìm thấy license hiện tại của cửa hàng.");

    const query = licenseHistorySchema.parse(request.query ?? {});
    const result = await getTargetAuditLogs("license", license.id, query.page, query.limit);
    return ok(response, result);
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

    // Audit log — no plaintext password or hash in payload
    await createAuditLog({
      adminUserId: request.authUserId!,
      action: "USER_PASSWORD_CHANGED",
      targetType: "user",
      targetId: userId,
      before: { redacted: true },
      after: { redacted: true },
      metadata: { method: "admin_set_password" },
      ip: getRequestIp(request),
      userAgent: getRequestUserAgent(request),
    });

    return ok(response, { message: "Đổi mật khẩu thành công." });
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
  query: z.string().default(""),
  username: z.string().optional(),
  status: z.enum(["active", "locked", "archived"]).optional(),
  role: z.enum(["user", "manager", "admin"]).optional(),
  licensePlan: z.enum(["trial", "basic", "pro", "vip"]).optional(),
  licenseStatus: z.string().trim().min(1).optional(),
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

const updateUserStatusSchema = z.object({
  status: z.enum(["active", "locked"]),
});

router.patch(
  "/users/:userId/status",
  requireAuth,
  requireManager,
  asyncHandler(async (request, response) => {
    const userId = String(request.params.userId);
    const body = updateUserStatusSchema.parse(request.body || {});
    const result = await updateUserStatus(userId, body.status);
    if (!result) throw notFound("Không tìm thấy người dùng.");

    const { user, beforeStatus } = result;

    // Audit log with before/after status snapshots
    await createAuditLog({
      adminUserId: request.authUserId!,
      action: "USER_STATUS_CHANGED",
      targetType: "user",
      targetId: userId,
      before: { status: beforeStatus },
      after: { status: body.status },
      ip: getRequestIp(request),
      userAgent: getRequestUserAgent(request),
    });

    return ok(response, { user });
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

// ─── User role change (admin only) ───────────────────────────────────────────

const updateUserRoleSchema = z.object({
  role: z.enum(["user", "manager", "admin"]),
});

router.patch(
  "/users/:userId/role",
  requireAuth,
  requireAdmin,
  asyncHandler(async (request, response) => {
    const userId = String(request.params.userId);
    const body = updateUserRoleSchema.parse(request.body || {});

    // Reject admin self-demotion
    if (userId === request.authUserId && body.role !== "admin") {
      throw badRequest("Không thể tự hạ quyền của chính bạn.");
    }

    const result = await updateUserRole(userId, body.role);
    if (!result) throw notFound("Không tìm thấy người dùng.");

    const { user, beforeRole } = result;

    // Audit log with before/after role snapshots
    await createAuditLog({
      adminUserId: request.authUserId!,
      action: "USER_ROLE_CHANGED",
      targetType: "user",
      targetId: userId,
      before: { role: beforeRole },
      after: { role: body.role },
      ip: getRequestIp(request),
      userAgent: getRequestUserAgent(request),
    });

    return ok(response, { user });
  }),
);

// ─── User overrides (manager+) ───────────────────────────────────────────────

const overridesSchema = z.object({
  maxDevices: z.number().int().min(1).nullable().optional(),
  features: z
    .record(z.enum(OVERRIDE_FEATURE_KEYS), z.boolean().nullable())
    .optional(),
});

router.patch(
  "/users/:userId/overrides",
  requireAuth,
  requireManager,
  asyncHandler(async (request, response) => {
    const userId = String(request.params.userId);
    const body = overridesSchema.parse(request.body || {});
    const result = await updateUserOverrides(userId, body, request.authUserId!);
    if (!result) throw notFound("Không tìm thấy người dùng.");

    await createAuditLog({
      adminUserId: request.authUserId!,
      action: "USER_OVERRIDES_CHANGED",
      targetType: "user",
      targetId: userId,
      before: result.before,
      after: result.after,
      ip: getRequestIp(request),
      userAgent: getRequestUserAgent(request),
    });

    return ok(response, { user: result.user });
  }),
);

// ─── User archive (soft delete, admin only) ──────────────────────────────────

router.delete(
  "/users/:userId",
  requireAuth,
  requireAdmin,
  asyncHandler(async (request, response) => {
    const userId = String(request.params.userId);

    // Reject self-archive
    if (userId === request.authUserId) {
      throw badRequest("Không thể tự lưu trữ tài khoản của chính bạn.");
    }

    const result = await archiveUser(userId);
    if (!result) throw notFound("Không tìm thấy người dùng.");

    const { user, beforeArchived } = result;

    // Audit log with before/after archive snapshots
    await createAuditLog({
      adminUserId: request.authUserId!,
      action: "USER_ARCHIVED",
      targetType: "user",
      targetId: userId,
      before: { archived: beforeArchived },
      after: { archived: true, deletedAt: user.deletedAt },
      ip: getRequestIp(request),
      userAgent: getRequestUserAgent(request),
    });

    return ok(response, { user });
  }),
);

// ─── Per-user audit log (manager+) ───────────────────────────────────────────

const userAuditLogSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

router.get(
  "/users/:userId/audit-log",
  requireAuth,
  requireManager,
  asyncHandler(async (request, response) => {
    const userId = String(request.params.userId);
    const query = userAuditLogSchema.parse(request.query ?? {});
    const result = await getUserAuditLogs(userId, query.page, query.limit);
    return ok(response, result);
  }),
);

export default router;
