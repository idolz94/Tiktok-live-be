import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env.js";
import { unauthorized } from "../lib/api-error.js";

export function requireInternalApiKey(request: Request, _response: Response, next: NextFunction) {
  try {
    const key = String(request.headers["x-internal-api-key"] || request.query.internalApiKey || "").trim();

    if (!env.nodeInternalApiKey) {
      throw unauthorized("NODE_INTERNAL_API_KEY chưa được cấu hình ở backend.");
    }

    if (key !== env.nodeInternalApiKey) {
      throw unauthorized("Internal API key không hợp lệ.");
    }

    next();
  } catch (error) {
    next(error);
  }
}
