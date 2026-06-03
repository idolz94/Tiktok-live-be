import type { Request, Response, NextFunction } from "express";
import { env } from "../config/env.js";
import { unauthorized } from "../lib/api-error.js";
import { supabaseAdmin } from "../lib/supabase.js";

function getBearerToken(request: Request) {
  const header = String(request.headers.authorization || "").trim();
  if (header.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim();
  }

  const cookieToken = request.cookies?.[env.authCookieName];
  if (typeof cookieToken === "string" && cookieToken.trim()) return cookieToken.trim();

  // EventSource cannot send custom Authorization headers. Allow token in query for SSE fallback.
  const queryToken = request.query.accessToken || request.query.token;
  return typeof queryToken === "string" ? queryToken.trim() : "";
}

export async function requireAuth(request: Request, _response: Response, next: NextFunction) {
  try {
    const token = getBearerToken(request);
    if (!token) throw unauthorized();

    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data.user) throw unauthorized(error?.message || "Phiên đăng nhập không hợp lệ.");

    request.authToken = token;
    request.authUser = data.user;
    next();
  } catch (error) {
    next(error);
  }
}
