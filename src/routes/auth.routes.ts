import { Router } from "express";
import { z } from "zod";
import { env } from "../config/env.js";
import { asyncHandler } from "../lib/async-handler.js";
import { badRequest } from "../lib/api-error.js";
import { mutateCreated, mutateOk, ok } from "../lib/response.js";
import { supabaseAdmin, supabasePublic } from "../lib/supabase.js";
import { requireAuth } from "../middlewares/auth.js";
import { addDays } from "../utils/date.js";
import { createTrialLicense } from "../services/license.service.js";

const router = Router();

const registerSchema = z.object({
  email: z.string().email("Email không hợp lệ."),
  password: z.string().min(6, "Mật khẩu phải có ít nhất 6 ký tự."),
  fullName: z.string().optional().default(""),
  phone: z.string().optional().default(""),
  tiktokId: z.string().optional().default(""),
  defaultTikTokUsername: z.string().optional().default(""),
  shopName: z.string().optional().default("Shop của tôi"),
});

const loginSchema = z.object({
  email: z.string().email("Email không hợp lệ."),
  password: z.string().min(1, "Vui lòng nhập mật khẩu."),
});

router.post(
  "/register",
  asyncHandler(async (request, response) => {
    const body = registerSchema.parse(request.body || {});
    const email = body.email.trim().toLowerCase();
    const now = new Date().toISOString();
    const licenseExpired = addDays(new Date(), env.trialDays).toISOString();

    const { data: userData, error: createUserError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: body.password,
      email_confirm: true,
      user_metadata: {
        full_name: body.fullName.trim(),
        phone: body.phone.trim(),
        tiktok_id: body.tiktokId.trim(),
        default_tiktok_username: body.defaultTikTokUsername.trim() || body.tiktokId.trim(),
      },
    });

    if (createUserError || !userData.user) {
      throw badRequest(createUserError?.message || "Không tạo được tài khoản.");
    }

    const user = userData.user;

    let shop: any = null;
    let shopMember: any = null;
    let license: any = null;

    try {
      const { error: profileError } = await supabaseAdmin.from("profiles").upsert({
        id: user.id,
        full_name: body.fullName.trim() || null,
        email,
        phone: body.phone.trim() || null,
        avatar_url: null,
        status: "active",
        created_at: now,
        updated_at: now,
      });

      if (profileError) throw new Error(profileError.message);

      const { data: createdShop, error: shopError } = await supabaseAdmin
        .from("shops")
        .insert({
          owner_id: user.id,
          name: body.shopName.trim() || "Shop của tôi",
          phone: body.phone.trim() || null,
          default_tiktok_username: body.defaultTikTokUsername.trim() || body.tiktokId.trim() || null,
          status: "active",
          license_status: "trial",
          license_expired_at: licenseExpired,
          created_at: now,
          updated_at: now,
        })
        .select("*")
        .single();

      if (shopError || !createdShop) throw new Error(shopError?.message || "Không tạo được shop.");
      shop = createdShop;

      const { data: createdShopMember, error: memberError } = await supabaseAdmin
        .from("shop_members")
        .insert({
          shop_id: shop.id,
          user_id: user.id,
          role: "owner",
          status: "active",
          invited_by: null,
          created_at: now,
          updated_at: now,
        })
        .select("*")
        .single();

      if (memberError) throw new Error(memberError.message);
      shopMember = createdShopMember;

      license = await createTrialLicense(shop.id);
    } catch (error) {
      // If database setup fails after creating the Supabase Auth user,
      // clean up the Auth user so the same email can register again.
      await supabaseAdmin.auth.admin.deleteUser(user.id).catch(() => null);
      throw error;
    }

    const { data: loginData, error: loginError } = await supabasePublic.auth.signInWithPassword({
      email,
      password: body.password,
    });

    if (loginError || !loginData.session) {
      return mutateCreated(response, "Đăng ký thành công. Vui lòng đăng nhập lại.", {
        user,
        profile: null,
        shop,
        shopMember,
        license,
        canUseApp: true,
        reason: null,
      });
    }

    response.cookie(env.authCookieName, loginData.session.access_token, {
      httpOnly: true,
      sameSite: env.nodeEnv === "production" ? "none" : "lax",
      secure: env.nodeEnv === "production",
      maxAge: 1000 * 60 * 60 * 24 * 30,
    });

    return mutateCreated(response, "Đăng ký thành công.", {
      user: loginData.user,
      session: loginData.session,
      accessToken: loginData.session.access_token,
      refreshToken: loginData.session.refresh_token,
      profile: null,
      shop,
      shopMember,
      license,
      canUseApp: true,
      reason: null,
    });
  }),
);

router.post(
  "/login",
  asyncHandler(async (request, response) => {
    const body = loginSchema.parse(request.body || {});
    const email = body.email.trim().toLowerCase();

    const { data, error } = await supabasePublic.auth.signInWithPassword({
      email,
      password: body.password,
    });

    if (error || !data.session) throw badRequest(error?.message || "Đăng nhập thất bại.");

    response.cookie(env.authCookieName, data.session.access_token, {
      httpOnly: true,
      sameSite: env.nodeEnv === "production" ? "none" : "lax",
      secure: env.nodeEnv === "production",
      maxAge: 1000 * 60 * 60 * 24 * 30,
    });

    return ok(response, {
      user: data.user,
      session: data.session,
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
    });
  }),
);

router.post(
  "/logout",
  requireAuth,
  asyncHandler(async (request, response) => {
    if (request.authToken) {
      await supabaseAdmin.auth.admin.signOut(request.authToken).catch(() => null);
    }

    response.clearCookie(env.authCookieName);
    return mutateOk(response, "Đăng xuất thành công.", null);
  }),
);

export default router;
