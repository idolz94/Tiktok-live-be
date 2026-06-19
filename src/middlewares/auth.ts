import type { Request, Response, NextFunction } from "express";
import { verifyAccessToken } from "../services/auth.service.js";
import { unauthorized } from "../lib/api-error.js";

function extractToken(request: Request): string {
  const header = String(request.headers.authorization || "").trim();
  if (header.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim();
  }
  const cookie = request.cookies?.["lumi_access_token"];
  if (typeof cookie === "string" && cookie.trim()) return cookie.trim();
  return "";
}

export function requireAuth(request: Request, _response: Response, next: NextFunction) {
  try {
    const token = extractToken(request);
    if (!token) throw unauthorized();

    const payload = verifyAccessToken(token);
    if (!payload?.sub) throw unauthorized("Phiên đăng nhập không hợp lệ.");

    request.authToken = token;
    request.authUserId = payload.sub;
    next();
  } catch (error) {
    next(error);
  }
}
