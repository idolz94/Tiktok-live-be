import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler.js";
import { ok, mutateOk } from "../lib/response.js";
import { badRequest, unauthorized } from "../lib/api-error.js";

// Strip HTML tags and null bytes to prevent XSS and injection
function sanitizeString(value: string): string {
  return value
    .replace(/<[^>]*>/g, "")   // strip HTML tags
    .replace(/\0/g, "")        // strip null bytes
    .trim();
}

const sanitizedString = (schema: z.ZodString) =>
  schema.transform(sanitizeString);
import {
  registerUser,
  loginUser,
  signAccessToken,
  signRefreshToken,
  saveRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  findOrCreateOAuthUser,
  getUserRole,
} from "../services/auth.service.js";
import { bootstrapAccountContext } from "../services/account.service.js";
import { createTikTokChannel } from "../services/tiktok-channels.service.js";
import { env } from "../config/env.js";
import { rateLimit } from "../middlewares/rate-limit.js";

const authRateLimit = rateLimit(10, 60_000); // 10 req/min per IP

const router = Router();

const refreshBodySchema = z.object({
  refreshToken: z.string().min(10).optional(),
});

const REFRESH_COOKIE = "lumi_refresh_token";
const ACCESS_COOKIE = "lumi_access_token";
const IS_PROD = env.nodeEnv === "production";

function setTokenCookies(response: import("express").Response, accessToken: string, refreshToken: string) {
  response.cookie(ACCESS_COOKIE, accessToken, {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: IS_PROD ? "none" : "lax",
    maxAge: 15 * 60 * 1000, // 15 min
    path: "/",
  });
  response.cookie(REFRESH_COOKIE, refreshToken, {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: IS_PROD ? "none" : "lax",
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    path: "/api/auth",
  });
}

function clearTokenCookies(response: import("express").Response) {
  response.clearCookie(ACCESS_COOKIE, { path: "/" });
  response.clearCookie(REFRESH_COOKIE, { path: "/api/auth" });
}

// ─── Register ──────────────────────────────────────────────────────────────────

const registerSchema = z.object({
  username: sanitizedString(
    z
      .string()
      .min(5, "Tên tài khoản phải có ít nhất 5 ký tự")
      .max(50)
      .regex(/^[\p{L}\p{N}]+$/u, "Tên tài khoản chỉ được gồm chữ cái và số"),
  ),
  password: z.string().min(6, "Mật khẩu phải có ít nhất 6 ký tự").max(128),
  fullName: sanitizedString(z.string().min(1, "Vui lòng nhập họ và tên").max(100)),
  tiktokId: sanitizedString(z.string().min(1, "Vui lòng nhập TikTok ID").max(100)),
  email: sanitizedString(z.string().email()).optional().nullable(),
  phone: sanitizedString(z.string().min(9).max(15)).optional().nullable(),
});

router.post(
  "/register",
  authRateLimit,
  asyncHandler(async (request, response) => {
    const body = registerSchema.parse(request.body || {});
    const user = await registerUser({
      username: body.username,
      password: body.password,
      email: body.email ?? undefined,
      phone: body.phone ?? undefined,
      fullName: body.fullName,
    });

    // Auto-bootstrap shop + trial license
    request.authUserId = user.id;
    const context = await bootstrapAccountContext(request);

    // Create default TikTok channel for the new shop
    if (context.shop?.id) {
      await createTikTokChannel({
        shopId: context.shop.id,
        tiktokUsername: body.tiktokId,
        isDefault: true,
      });
    }

    const accessToken = signAccessToken(user.id, user.role);
    const refreshToken = signRefreshToken(user.id);
    await saveRefreshToken(user.id, refreshToken);

    setTokenCookies(response, accessToken, refreshToken);

    return ok(response, {
      user: { id: user.id, username: user.username, email: user.email, fullName: user.fullName },
      accessToken,
      refreshToken,
    });
  }),
);

// ─── Login ─────────────────────────────────────────────────────────────────────

const loginSchema = z.object({
  username: sanitizedString(z.string().min(1, "Vui lòng nhập tên tài khoản")),
  password: z.string().min(1, "Vui lòng nhập mật khẩu").max(128),
});

router.post(
  "/login",
  authRateLimit,
  asyncHandler(async (request, response) => {
    const body = loginSchema.parse(request.body || {});
    const user = await loginUser({ username: body.username, password: body.password });

    const accessToken = signAccessToken(user.id, user.role);
    const refreshToken = signRefreshToken(user.id);
    await saveRefreshToken(user.id, refreshToken);

    setTokenCookies(response, accessToken, refreshToken);

    return ok(response, {
      user: { id: user.id, username: user.username, email: user.email, fullName: user.fullName },
      accessToken,
      refreshToken,
    });
  }),
);

// ─── Refresh ───────────────────────────────────────────────────────────────────

router.post(
  "/refresh",
  authRateLimit,
  asyncHandler(async (request, response) => {
    const body = refreshBodySchema.parse(request.body || {});
    const token: string =
      request.cookies?.[REFRESH_COOKIE] ||
      body.refreshToken ||
      "";

    if (!token) throw unauthorized("Refresh token không tồn tại.");

    const { userId, newRefreshToken } = await rotateRefreshToken(token);
    const role = await getUserRole(userId);
    const newAccessToken = signAccessToken(userId, role);

    setTokenCookies(response, newAccessToken, newRefreshToken);

    return ok(response, { accessToken: newAccessToken, refreshToken: newRefreshToken });
  }),
);

// ─── Logout ────────────────────────────────────────────────────────────────────

router.post(
  "/logout",
  asyncHandler(async (request, response) => {
    const token: string = request.cookies?.[REFRESH_COOKIE] || "";
    if (token) {
      await revokeRefreshToken(token).catch(() => null);
    }
    clearTokenCookies(response);
    return mutateOk(response, "Đăng xuất thành công.", null);
  }),
);

// ─── OAuth — Google ────────────────────────────────────────────────────────────

router.get(
  "/oauth/google",
  asyncHandler(async (_request, response) => {
    if (!env.googleClientId) throw badRequest("Google OAuth chưa được cấu hình.");

    const params = new URLSearchParams({
      client_id: env.googleClientId,
      redirect_uri: env.googleCallbackUrl,
      response_type: "code",
      scope: "openid email profile",
      access_type: "offline",
      prompt: "select_account",
    });
    response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  }),
);

router.get(
  "/oauth/google/callback",
  asyncHandler(async (request, response) => {
    const code = String(request.query.code || "");
    if (!code) throw badRequest("Thiếu authorization code từ Google.");

    // Exchange code for tokens
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: env.googleClientId,
        client_secret: env.googleClientSecret,
        redirect_uri: env.googleCallbackUrl,
        grant_type: "authorization_code",
      }),
    });
    const tokenData = (await tokenRes.json()) as Record<string, unknown>;
    if (!tokenRes.ok) throw badRequest("Không lấy được token từ Google.");

    // Get user info
    const userRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const userInfo = (await userRes.json()) as Record<string, string>;

    const user = await findOrCreateOAuthUser({
      provider: "google",
      providerUserId: userInfo.sub,
      email: userInfo.email,
      fullName: userInfo.name,
      avatarUrl: userInfo.picture,
      accessToken: String(tokenData.access_token ?? ""),
      refreshToken: String(tokenData.refresh_token ?? ""),
      expiresAt: tokenData.expires_in
        ? new Date(Date.now() + Number(tokenData.expires_in) * 1000)
        : null,
    });

    if (!user) throw unauthorized("Không thể xác thực tài khoản Google.");

    // Bootstrap shop/license
    request.authUserId = user.id;
    await bootstrapAccountContext(request);

    const accessToken = signAccessToken(user.id, user.role);
    const refreshToken = signRefreshToken(user.id);
    await saveRefreshToken(user.id, refreshToken);
    setTokenCookies(response, accessToken, refreshToken);

    // Redirect về frontend
    const frontendUrl = env.clientOrigin.split(",")[0].trim();
    response.redirect(`${frontendUrl}/dashboard`);
  }),
);

// ─── OAuth — Facebook ──────────────────────────────────────────────────────────

router.get(
  "/oauth/facebook",
  asyncHandler(async (_request, response) => {
    if (!env.facebookAppId) throw badRequest("Facebook OAuth chưa được cấu hình.");

    const params = new URLSearchParams({
      client_id: env.facebookAppId,
      redirect_uri: env.facebookCallbackUrl,
      scope: "email,public_profile",
      response_type: "code",
    });
    response.redirect(`https://www.facebook.com/v19.0/dialog/oauth?${params}`);
  }),
);

router.get(
  "/oauth/facebook/callback",
  asyncHandler(async (request, response) => {
    const code = String(request.query.code || "");
    if (!code) throw badRequest("Thiếu authorization code từ Facebook.");

    // Exchange code for access token
    const tokenRes = await fetch(
      `https://graph.facebook.com/v19.0/oauth/access_token?` +
        new URLSearchParams({
          client_id: env.facebookAppId,
          client_secret: env.facebookAppSecret,
          redirect_uri: env.facebookCallbackUrl,
          code,
        }),
    );
    const tokenData = (await tokenRes.json()) as Record<string, unknown>;
    if (!tokenRes.ok) throw badRequest("Không lấy được token từ Facebook.");

    // Get user info
    const userRes = await fetch(
      `https://graph.facebook.com/v19.0/me?fields=id,name,email,picture&access_token=${tokenData.access_token}`,
    );
    const userInfo = (await userRes.json()) as Record<string, unknown>;
    const picture = (userInfo.picture as Record<string, Record<string, string>> | undefined)?.data?.url;

    const user = await findOrCreateOAuthUser({
      provider: "facebook",
      providerUserId: String(userInfo.id ?? ""),
      email: typeof userInfo.email === "string" ? userInfo.email : null,
      fullName: typeof userInfo.name === "string" ? userInfo.name : null,
      avatarUrl: picture ?? null,
      accessToken: String(tokenData.access_token ?? ""),
      refreshToken: null,
      expiresAt: null,
    });

    if (!user) throw unauthorized("Không thể xác thực tài khoản Facebook.");

    request.authUserId = user.id;
    await bootstrapAccountContext(request);

    const accessToken = signAccessToken(user.id, user.role);
    const refreshToken = signRefreshToken(user.id);
    await saveRefreshToken(user.id, refreshToken);
    setTokenCookies(response, accessToken, refreshToken);

    const frontendUrl = env.clientOrigin.split(",")[0].trim();
    response.redirect(`${frontendUrl}/dashboard`);
  }),
);

export default router;
