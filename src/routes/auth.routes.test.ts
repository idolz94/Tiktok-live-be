import express from "express";
import cookieParser from "cookie-parser";
import { afterEach, describe, expect, it, vi } from "vitest";
import authRoutes from "./auth.routes.js";
import { errorHandler } from "../middlewares/error.js";
import { resetPasswordWithTikTok } from "../services/auth.service.js";
import { ApiError } from "../lib/api-error.js";

vi.mock("../services/auth.service.js", () => ({
  registerUser: vi.fn(),
  loginUser: vi.fn(),
  resetPasswordWithTikTok: vi.fn(),
  signAccessToken: vi.fn(),
  signRefreshToken: vi.fn(),
  saveRefreshToken: vi.fn(),
  rotateRefreshToken: vi.fn(),
  revokeRefreshToken: vi.fn(),
  findOrCreateOAuthUser: vi.fn(),
  getActiveUserRole: vi.fn(),
}));

function createTestServer() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/auth", authRoutes);
  app.use(errorHandler);

  return new Promise<{ baseUrl: string; close: () => Promise<void> }>((resolve, reject) => {
    const server = app.listen(0, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Unable to start test server"));
        return;
      }

      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

describe("auth refresh route", () => {
  const servers: Array<{ close: () => Promise<void> }> = [];

  afterEach(async () => {
    vi.clearAllMocks();
    await Promise.all(servers.splice(0).map((server) => server.close()));
  });

  it("returns a stable 401 response when the refresh cookie is missing", async () => {
    const server = await createTestServer();
    servers.push(server);

    const response = await fetch(`${server.baseUrl}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    await expect(response.json()).resolves.toEqual({
      ok: false,
      message: "Refresh token không tồn tại.",
      code: "UNAUTHORIZED",
    });
    expect(response.status).toBe(401);
  });

  it("resets password with username and TikTok ID", async () => {
    vi.mocked(resetPasswordWithTikTok).mockResolvedValueOnce(undefined);
    const server = await createTestServer();
    servers.push(server);

    const response = await fetch(`${server.baseUrl}/api/auth/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "  seller01  ",
        tiktokId: "  @shopabc  ",
        newPassword: "new-password",
      }),
    });

    await expect(response.json()).resolves.toEqual({
      status: "success",
      message: "Đổi mật khẩu thành công. Vui lòng đăng nhập lại.",
      data: null,
    });
    expect(response.status).toBe(200);
    expect(resetPasswordWithTikTok).toHaveBeenCalledWith({
      username: "seller01",
      tiktokId: "@shopabc",
      newPassword: "new-password",
    });
  });

  it("returns username-specific reset password errors", async () => {
    vi.mocked(resetPasswordWithTikTok).mockRejectedValueOnce(
      new ApiError(
        400,
        "Tên tài khoản không đúng.",
        "RESET_PASSWORD_USERNAME_NOT_FOUND",
      ),
    );
    const server = await createTestServer();
    servers.push(server);

    const response = await fetch(`${server.baseUrl}/api/auth/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "missing",
        tiktokId: "@shopabc",
        newPassword: "new-password",
      }),
    });

    await expect(response.json()).resolves.toEqual({
      ok: false,
      message: "Tên tài khoản không đúng.",
      code: "RESET_PASSWORD_USERNAME_NOT_FOUND",
    });
    expect(response.status).toBe(400);
  });

  it("returns TikTok ID-specific reset password errors", async () => {
    vi.mocked(resetPasswordWithTikTok).mockRejectedValueOnce(
      new ApiError(
        400,
        "TikTok ID không đúng.",
        "RESET_PASSWORD_TIKTOK_ID_NOT_FOUND",
      ),
    );
    const server = await createTestServer();
    servers.push(server);

    const response = await fetch(`${server.baseUrl}/api/auth/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "seller01",
        tiktokId: "@missing",
        newPassword: "new-password",
      }),
    });

    await expect(response.json()).resolves.toEqual({
      ok: false,
      message: "TikTok ID không đúng.",
      code: "RESET_PASSWORD_TIKTOK_ID_NOT_FOUND",
    });
    expect(response.status).toBe(400);
  });
});
