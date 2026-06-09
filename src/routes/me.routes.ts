import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler.js";
import { mutateCreated, mutateOk, ok } from "../lib/response.js";
import { requireAuth } from "../middlewares/auth.js";
import { getAccountContext, requireShopId } from "../services/account.service.js";
import {
  createTikTokChannel,
  deleteTikTokChannel,
  listTikTokChannels,
  updateTikTokChannel,
} from "../services/tiktok-channels.service.js";

const router = Router();

const createChannelSchema = z.object({
  tiktokUsername: z.string().min(1, "Thiếu tiktokUsername."),
  displayName: z.string().optional().nullable(),
  isDefault: z.boolean().optional(),
});

const updateChannelSchema = z.object({
  tiktokUsername: z.string().min(1).optional(),
  displayName: z.string().optional().nullable(),
  isDefault: z.boolean().optional(),
});

router.get(
  "/bootstrap",
  requireAuth,
  asyncHandler(async (request, response) => {
    const context = await getAccountContext(request);

    const tiktokChannels = context.shop?.id
      ? await listTikTokChannels(context.shop.id)
      : [];

    return ok(response, {
      user: context.user,
      profile: context.profile,
      shopMember: context.shopMember,
      member: context.shopMember,
      shop: context.shop,
      license: context.license,
      canUseApp: context.canUseApp,
      reason: context.reason,
      tiktokChannels,
    });
  }),
);

// GET /api/me/tiktok-channels
router.get(
  "/tiktok-channels",
  requireAuth,
  asyncHandler(async (request, response) => {
    const shopId = await requireShopId(request);
    const channels = await listTikTokChannels(shopId);
    return ok(response, { channels });
  }),
);

// POST /api/me/tiktok-channels
router.post(
  "/tiktok-channels",
  requireAuth,
  asyncHandler(async (request, response) => {
    const shopId = await requireShopId(request);
    const body = createChannelSchema.parse(request.body || {});
    const channel = await createTikTokChannel({
      shopId,
      tiktokUsername: body.tiktokUsername,
      displayName: body.displayName,
      isDefault: body.isDefault,
    });
    return mutateCreated(response, "Thêm kênh TikTok thành công.", { channel });
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

// DELETE /api/me/tiktok-channels/:channelId
router.delete(
  "/tiktok-channels/:channelId",
  requireAuth,
  asyncHandler(async (request, response) => {
    const shopId = await requireShopId(request);
    await deleteTikTokChannel({
      shopId,
      channelId: String(request.params.channelId),
    });
    return mutateOk(response, "Xóa kênh TikTok thành công.", null);
  }),
);

export default router;

