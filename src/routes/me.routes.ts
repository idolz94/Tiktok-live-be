import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler.js";
import { ok } from "../lib/response.js";
import { requireAuth } from "../middlewares/auth.js";
import { getAccountContext, requireAccountContext } from "../services/account.service.js";
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
    const context = await requireAccountContext(request);
    const channels = await listTikTokChannels(context.shop.id);
    return ok(response, { channels });
  }),
);

// POST /api/me/tiktok-channels
router.post(
  "/tiktok-channels",
  requireAuth,
  asyncHandler(async (request, response) => {
    const context = await requireAccountContext(request);
    const body = createChannelSchema.parse(request.body || {});
    const channel = await createTikTokChannel({
      shopId: context.shop.id,
      tiktokUsername: body.tiktokUsername,
      displayName: body.displayName,
      isDefault: body.isDefault,
    });
    return ok(response, { channel }, 201);
  }),
);

// PATCH /api/me/tiktok-channels/:channelId
router.patch(
  "/tiktok-channels/:channelId",
  requireAuth,
  asyncHandler(async (request, response) => {
    const context = await requireAccountContext(request);
    const body = updateChannelSchema.parse(request.body || {});
    const channel = await updateTikTokChannel({
      shopId: context.shop.id,
      channelId: String(request.params.channelId),
      tiktokUsername: body.tiktokUsername,
      displayName: body.displayName,
      isDefault: body.isDefault,
    });
    return ok(response, { channel });
  }),
);

// DELETE /api/me/tiktok-channels/:channelId
router.delete(
  "/tiktok-channels/:channelId",
  requireAuth,
  asyncHandler(async (request, response) => {
    const context = await requireAccountContext(request);
    await deleteTikTokChannel({
      shopId: context.shop.id,
      channelId: String(request.params.channelId),
    });
    return ok(response, { success: true });
  }),
);

export default router;

