import type { Response } from "express";

export function ok(response: Response, data: unknown = null, statusCode = 200) {
  return response.status(statusCode).json({ ok: true, data });
}

export function created(response: Response, data: unknown = null) {
  return ok(response, data, 201);
}

export function mutateOk(response: Response, message: string, data: unknown = null, statusCode = 200) {
  return response.status(statusCode).json({ status: "success", message, data });
}

export function mutateCreated(response: Response, message: string, data: unknown = null) {
  return mutateOk(response, message, data, 201);
}
