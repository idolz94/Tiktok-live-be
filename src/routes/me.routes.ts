import { Router } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { asyncHandler } from "../lib/async-handler.js";
import { mutateOk, ok } from "../lib/response.js";
import { requireAuth } from "../middlewares/auth.js";
import { ApiError } from "../lib/api-error.js";
import { db } from "../lib/db.js";
import { users, shops } from "../db/schema/index.js";
import { bootstrapAccountContext, getShopActivityFlags, requireUsableAccountContext } from "../services/account.service.js";
import {
  listTikTokChannelsWithBackfill,
  updateTikTokChannel,
} from "../services/tiktok-channels.service.js";
import { spxCreateAccount } from "../services/providers/spx.service.js";
import { verifyAndChangeUserPassword } from "../services/auth.service.js";

const router = Router();

const updateChannelSchema = z.object({
  tiktokUsername: z.string().min(1).optional(),
  displayName: z.string().optional().nullable(),
  isDefault: z.boolean().optional(),
});

router.get(
  "/bootstrap",
  requireAuth,
  asyncHandler(async (request, response) => {
    const context = await bootstrapAccountContext(request);

    const tiktokChannels = context.shop?.id
      ? await listTikTokChannelsWithBackfill(context.shop.id)
      : [];

    const { hasOrders, hasHistory } = context.shop?.id
      ? await getShopActivityFlags(context.shop.id)
      : { hasOrders: false, hasHistory: false };

    return ok(response, {
      userId: context.userId,
      profile: context.user,
      shopMember: context.shopMember,
      member: context.shopMember,
      shop: context.shop,
      license: context.license,
      canUseApp: context.canUseApp,
      reason: context.reason,
      tiktokChannels,
      hasOrders,
      hasHistory,
    });
  }),
);

// GET /api/me/tiktok-channels
router.get(
  "/tiktok-channels",
  requireAuth,
  asyncHandler(async (request, response) => {
    const context = await bootstrapAccountContext(request);
    const shopId = context.shop?.id;
    if (!shopId) return ok(response, { channels: [] });

    const channels = await listTikTokChannelsWithBackfill(shopId);
    return ok(response, { channels });
  }),
);

// PATCH /api/me/tiktok-channels/:channelId
router.patch(
  "/tiktok-channels/:channelId",
  requireAuth,
  asyncHandler(async (request, response) => {
    const ctx = await requireUsableAccountContext(request);
    const body = updateChannelSchema.parse(request.body || {});
    const channel = await updateTikTokChannel({
      shopId: ctx.shop.id,
      channelId: String(request.params.channelId),
      tiktokUsername: body.tiktokUsername,
      displayName: body.displayName,
      isDefault: body.isDefault,
    });
    return mutateOk(response, "Cập nhật kênh TikTok thành công.", { channel });
  }),
);

// GET /api/me/spx/account
router.get(
  "/spx/account",
  requireAuth,
  asyncHandler(async (request, response) => {
    const userId = request.authUserId!;
    const rows = await db.select({ spxUserId: users.spxUserId })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const connected = !!(rows[0]?.spxUserId);
    return ok(response, { connected });
  }),
);

const spxRegisterSchema = z.object({
  phone: z.string().min(1).max(32),
  email: z.string().email().max(64).optional(),
});

// POST /api/me/spx/account
router.post(
  "/spx/account",
  requireAuth,
  asyncHandler(async (request, response) => {
    const userId = request.authUserId!;

    const existing = await db.select({ spxUserId: users.spxUserId })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (existing[0]?.spxUserId) {
      throw new ApiError(409, "Tài khoản SPX đã được kết nối.", "SPX_ALREADY_CONNECTED");
    }

    const body = spxRegisterSchema.parse(request.body || {});
    const { userId: spxUserId, userSecret } = await spxCreateAccount({ phone: body.phone, email: body.email });

    await db.update(users)
      .set({ spxUserId, spxUserSecret: userSecret })
      .where(eq(users.id, userId));

    // ponytail: userSecret never returned to client
    return ok(response, { connected: true });
  }),
);

// DELETE /api/me/spx/account
router.delete(
  "/spx/account",
  requireAuth,
  asyncHandler(async (request, response) => {
    const userId = request.authUserId!;
    await db.update(users)
      .set({ spxUserId: null, spxUserSecret: null })
      .where(eq(users.id, userId));
    return mutateOk(response, "Đã ngắt kết nối tài khoản SPX.");
  }),
);

const updateProfileSchema = z.object({
  fullName: z.string().min(1).max(100).optional(),
  phone: z.string().min(1).max(20).optional().nullable(),
  shopName: z.string().min(1).max(100).optional(),
  facebookUrl: z.string().max(500).optional().nullable(),
  tiktokUrl: z.string().max(500).optional().nullable(),
  youtubeUrl: z.string().max(500).optional().nullable(),
});

// PATCH /api/me/profile
router.patch(
  "/profile",
  requireAuth,
  asyncHandler(async (request, response) => {
    const userId = request.authUserId!;
    const body = updateProfileSchema.parse(request.body || {});

    const hasUserUpdate =
      body.fullName !== undefined ||
      body.phone !== undefined ||
      body.facebookUrl !== undefined ||
      body.tiktokUrl !== undefined ||
      body.youtubeUrl !== undefined;

    if (hasUserUpdate) {
      const userUpdates: {
        fullName?: string;
        phone?: string | null;
        facebookUrl?: string | null;
        tiktokUrl?: string | null;
        youtubeUrl?: string | null;
      } = {};
      if (body.fullName !== undefined) userUpdates.fullName = body.fullName;
      if (body.phone !== undefined) userUpdates.phone = body.phone;
      if (body.facebookUrl !== undefined) userUpdates.facebookUrl = body.facebookUrl;
      if (body.tiktokUrl !== undefined) userUpdates.tiktokUrl = body.tiktokUrl;
      if (body.youtubeUrl !== undefined) userUpdates.youtubeUrl = body.youtubeUrl;
      await db.update(users).set(userUpdates).where(eq(users.id, userId));
    }

    if (body.shopName !== undefined) {
      const context = await bootstrapAccountContext(request);
      if (context.shop?.id) {
        await db.update(shops).set({ name: body.shopName }).where(eq(shops.id, context.shop.id));
      }
    }

    return mutateOk(response, "Cập nhật hồ sơ thành công.");
  }),
);

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z
    .string()
    .min(6, "Mật khẩu mới phải có ít nhất 6 ký tự.")
    .regex(/^[a-zA-Z0-9]+$/, "Mật khẩu chỉ được chứa chữ cái và chữ số."),
});

// PATCH /api/me/password
router.patch(
  "/password",
  requireAuth,
  asyncHandler(async (request, response) => {
    const userId = request.authUserId!;
    const body = changePasswordSchema.parse(request.body || {});
    await verifyAndChangeUserPassword(userId, body.currentPassword, body.newPassword);
    return mutateOk(response, "Đổi mật khẩu thành công.");
  }),
);

export default router;

