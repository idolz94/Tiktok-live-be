import type { Response } from "express";

export function ok(response: Response, data: unknown = null, statusCode = 200) {
  return response.status(statusCode).json({ ok: true, data });
}

export function created(response: Response, data: unknown = null) {
  return ok(response, data, 201);
}
