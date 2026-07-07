import type { Request, Response, NextFunction } from "express";
import { forbidden } from "../lib/api-error.js";

export function requireAdmin(request: Request, _response: Response, next: NextFunction) {
  if (request.authUserRole !== "admin") {
    throw forbidden("Không có quyền admin.");
  }
  next();
}

export function requireManager(request: Request, _response: Response, next: NextFunction) {
  if (!["admin", "manager"].includes(request.authUserRole ?? "")) {
    throw forbidden("Không có quyền.");
  }
  next();
}
