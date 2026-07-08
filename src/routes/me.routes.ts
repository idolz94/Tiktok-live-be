import { Router } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { asyncHandler } from "../lib/async-handler.js";
import { mutateOk, ok } from "../lib/response.js";
import { requireAuth } from "../middlewares/auth.js";
import { ApiError } from "../lib/api-error.js";
import { db } from "../lib/db.js";
import { users } from "../db/schema/index.js";
import { bootstrapAccountContext, getShopActivityFlags, requireShopId } from "../services/account.service.js";
import {
  listTikTokChannelsWithBackfill,
  updateTikTokChannel,
} from "../services/tiktok-channels.service.js";
import { spxCreateAccount } from "../services/providers/spx.service.js";

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
    const shopId = await requireShopId(request);
    const body = updateChannelSchema.parse(request.body || {});
    const channel = await updateTikTokChannel({
      shopId,
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

export default router;

