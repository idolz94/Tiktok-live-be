import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { eq, and, or } from "drizzle-orm";
import { db } from "../lib/db.js";
import { users, oauthAccounts, refreshTokens } from "../db/schema/index.js";
import { env } from "../config/env.js";
import { badRequest, unauthorized } from "../lib/api-error.js";

const SALT_ROUNDS = 12;

// ─── Token helpers ────────────────────────────────────────────────────────────

export function signAccessToken(userId: string): string {
  return jwt.sign({ sub: userId }, env.jwtSecret, {
    expiresIn: env.jwtAccessExpiresIn as jwt.SignOptions["expiresIn"],
  });
}

export function signRefreshToken(userId: string): string {
  return jwt.sign({ sub: userId }, env.jwtRefreshSecret, {
    expiresIn: env.jwtRefreshExpiresIn as jwt.SignOptions["expiresIn"],
  });
}

export function verifyAccessToken(token: string): { sub: string } {
  try {
    return jwt.verify(token, env.jwtSecret) as { sub: string };
  } catch {
    throw unauthorized("Phiên đăng nhập không hợp lệ.");
  }
}

export function verifyRefreshToken(token: string): { sub: string } {
  try {
    return jwt.verify(token, env.jwtRefreshSecret) as { sub: string };
  } catch {
    throw unauthorized("Refresh token không hợp lệ.");
  }
}

function refreshTokenExpiresAt(): Date {
  // Parse "30d" → days, "7d" → days, fallback 30 days
  const raw = env.jwtRefreshExpiresIn;
  const days = raw.endsWith("d") ? parseInt(raw, 10) : 30;
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

// ─── Register ─────────────────────────────────────────────────────────────────

export async function registerUser(input: {
  username: string;
  password: string;
  fullName: string;
  email?: string;
  phone?: string;
}) {
  const username = input.username.trim().toLowerCase();

  // Check uniqueness
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, username))
    .limit(1);

  if (existing[0]) {
    throw badRequest("Username đã tồn tại.");
  }

  if (input.email) {
    const emailRow = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, input.email.toLowerCase()))
      .limit(1);
    if (emailRow[0]) throw badRequest("Email đã được đăng ký.");
  }

  if (input.phone) {
    const phoneRow = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.phone, input.phone))
      .limit(1);
    if (phoneRow[0]) throw badRequest("Số điện thoại đã được đăng ký.");
  }

  const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS);

  const [user] = await db
    .insert(users)
    .values({
      username,
      passwordHash,
      email: input.email?.toLowerCase() ?? null,
      phone: input.phone ?? null,
      fullName: input.fullName ?? null,
      status: "active",
    })
    .returning();

  return user;
}

// ─── Login ────────────────────────────────────────────────────────────────────

export async function loginUser(input: { username: string; password: string }) {
  const identifier = input.username.trim().toLowerCase();

  // Accept username, email, or phone — single query
  const rows = await db
    .select()
    .from(users)
    .where(or(eq(users.username, identifier), eq(users.email, identifier), eq(users.phone, identifier)))
    .limit(1);

  let user = rows[0] ?? null;

  if (!user || !user.passwordHash) {
    throw unauthorized("Sai username hoặc mật khẩu.");
  }

  if (user.status !== "active") {
    throw unauthorized("Tài khoản đã bị khóa.");
  }

  const valid = await bcrypt.compare(input.password, user.passwordHash);
  if (!valid) {
    throw unauthorized("Sai username hoặc mật khẩu.");
  }

  return user;
}

// ─── Refresh token store ──────────────────────────────────────────────────────

export async function saveRefreshToken(userId: string, token: string) {
  await db.insert(refreshTokens).values({
    userId,
    token,
    expiresAt: refreshTokenExpiresAt(),
  });
}

export async function rotateRefreshToken(oldToken: string): Promise<{ userId: string; newRefreshToken: string }> {
  const payload = verifyRefreshToken(oldToken);
  const userId = payload.sub;

  const rows = await db
    .select()
    .from(refreshTokens)
    .where(and(eq(refreshTokens.token, oldToken), eq(refreshTokens.userId, userId)))
    .limit(1);

  if (!rows[0]) {
    throw unauthorized("Refresh token không tồn tại hoặc đã bị thu hồi.");
  }

  if (rows[0].expiresAt < new Date()) {
    await db.delete(refreshTokens).where(eq(refreshTokens.token, oldToken));
    throw unauthorized("Refresh token đã hết hạn.");
  }

  // Rotate — delete old, issue new
  await db.delete(refreshTokens).where(eq(refreshTokens.token, oldToken));
  const newRefreshToken = signRefreshToken(userId);
  await saveRefreshToken(userId, newRefreshToken);

  return { userId, newRefreshToken };
}

export async function revokeRefreshToken(token: string) {
  await db.delete(refreshTokens).where(eq(refreshTokens.token, token));
}

// ─── OAuth ────────────────────────────────────────────────────────────────────

export async function findOrCreateOAuthUser(input: {
  provider: "google" | "facebook";
  providerUserId: string;
  email?: string | null;
  fullName?: string | null;
  avatarUrl?: string | null;
  accessToken?: string | null;
  refreshToken?: string | null;
  expiresAt?: Date | null;
}) {
  // Find existing oauth link
  const oauthRows = await db
    .select({ userId: oauthAccounts.userId })
    .from(oauthAccounts)
    .where(
      and(
        eq(oauthAccounts.provider, input.provider),
        eq(oauthAccounts.providerUserId, input.providerUserId),
      ),
    )
    .limit(1);

  if (oauthRows[0]) {
    const userRows = await db
      .select()
      .from(users)
      .where(eq(users.id, oauthRows[0].userId))
      .limit(1);
    return userRows[0] ?? null;
  }

  // Try to link to existing user by email
  let user = null;
  if (input.email) {
    const byEmail = await db
      .select()
      .from(users)
      .where(eq(users.email, input.email.toLowerCase()))
      .limit(1);
    user = byEmail[0] ?? null;
  }

  // Create new user if none found
  if (!user) {
    // Generate a unique username from provider + id
    const baseUsername = `${input.provider}_${input.providerUserId}`.toLowerCase().slice(0, 50);
    const [created] = await db
      .insert(users)
      .values({
        username: baseUsername,
        email: input.email?.toLowerCase() ?? null,
        fullName: input.fullName ?? null,
        avatarUrl: input.avatarUrl ?? null,
        status: "active",
      })
      .returning();
    user = created;
  }

  // Create oauth link
  await db
    .insert(oauthAccounts)
    .values({
      userId: user.id,
      provider: input.provider,
      providerUserId: input.providerUserId,
      email: input.email?.toLowerCase() ?? null,
      accessToken: input.accessToken ?? null,
      refreshToken: input.refreshToken ?? null,
      expiresAt: input.expiresAt ?? null,
    })
    .onConflictDoNothing();

  return user;
}
