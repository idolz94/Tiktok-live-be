import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler.js";
import { ok } from "../lib/response.js";
import { requireAuth } from "../middlewares/auth.js";
import { supabaseAdmin } from "../lib/supabase.js";
import { getAccountContext, requireAccountContext } from "../services/account.service.js";
import { normalizeAtUsername } from "../utils/tiktok.js";

const router = Router();

const updateProfileSchema = z.object({
  defaultTiktokUsername: z.string().min(1, "Thiếu defaultTiktokUsername."),
});

router.get(
  "/bootstrap",
  requireAuth,
  asyncHandler(async (request, response) => {
    const context = await getAccountContext(request);

    return ok(response, {
      user: context.user,
      profile: context.profile,
      shopMember: context.shopMember,
      member: context.shopMember,
      shop: context.shop,
      license: context.license,
      canUseApp: context.canUseApp,
      reason: context.reason,
    });
  }),
);

router.patch(
  "/profile",
  requireAuth,
  asyncHandler(async (request, response) => {
    const context = await requireAccountContext(request);
    const body = updateProfileSchema.parse(request.body || {});

    const normalizedUsername = normalizeAtUsername(body.defaultTiktokUsername);

    const { data: shop, error } = await supabaseAdmin
      .from("shops")
      .update({
        default_tiktok_username: normalizedUsername,
        updated_at: new Date().toISOString(),
      })
      .eq("id", context.shop.id)
      .select("*")
      .single();

    if (error) throw new Error(error.message);

    return ok(response, { shop });
  }),
);

export default router;
