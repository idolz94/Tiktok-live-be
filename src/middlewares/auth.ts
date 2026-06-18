import type { Request, Response, NextFunction } from "express";
import { verifyToken } from "@clerk/express";
import { env } from "../config/env.js";
import { unauthorized } from "../lib/api-error.js";

function getBearerToken(request: Request) {
  const header = String(request.headers.authorization || "").trim();
  if (header.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim();
  }
  // Next.js web gửi cookie __session (Clerk default)
  const cookieToken = request.cookies?.["__session"];
  if (typeof cookieToken === "string" && cookieToken.trim()) return cookieToken.trim();

  return "";
}

function getAuthorizedParties(): string[] {
  const parties = [
    env.clientOrigin,
    "http://localhost:3000",
    "http://127.0.0.1:3000",
  ];
  // clientOrigin có thể là comma-separated list
  const fromEnv = env.clientOrigin
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set([...fromEnv, ...parties])];
}

export async function requireAuth(
  request: Request,
  _response: Response,
  next: NextFunction,
) {
  try {
    const token = getBearerToken(request);

    if (!token) {
      throw unauthorized();
    }

    const payload = await verifyToken(token, {
      secretKey: env.clerkSecretKey,
      authorizedParties: getAuthorizedParties(),
    });

    if (!payload?.sub) {
      throw unauthorized("Phiên đăng nhập không hợp lệ.");
    }

    request.authToken = token;
    request.authUserId = payload.sub;

    next();
  } catch (error) {
    console.error("[Clerk verifyToken failed]", error);

    next(
      unauthorized("Phiên đăng nhập không hợp lệ."),
    );
  }
}
