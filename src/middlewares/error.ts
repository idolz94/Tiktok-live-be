import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { ApiError } from "../lib/api-error.js";

export function notFoundHandler(request: Request, response: Response) {
  response.status(404).json({
    ok: false,
    message: `Không tìm thấy API ${request.method} ${request.path}`,
    code: "ROUTE_NOT_FOUND",
  });
}

export function errorHandler(error: unknown, _request: Request, response: Response, _next: NextFunction) {
  if (error instanceof ZodError) {
    return response.status(400).json({
      ok: false,
      message: error.issues[0]?.message || "Dữ liệu gửi lên không hợp lệ.",
      code: "VALIDATION_ERROR",
      details: error.issues,
    });
  }

  if (error instanceof ApiError) {
    return response.status(error.statusCode).json({
      ok: false,
      message: error.message,
      code: error.code,
      details: error.details,
    });
  }

  console.error("UNHANDLED_ERROR", error);

  return response.status(500).json({
    ok: false,
    message: error instanceof Error ? error.message : "Server lỗi.",
    code: "INTERNAL_SERVER_ERROR",
  });
}
