import type { NextFunction, Request, Response } from "express";

type Bucket = { count: number; resetAt: number };
const store = new Map<string, Bucket>();

// ponytail: in-memory sliding window; replace with Redis-based if horizontal scaling is needed
export function rateLimit(maxRequests: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = (req.ip ?? req.socket.remoteAddress ?? "unknown") as string;
    const now = Date.now();
    const bucket = store.get(ip);

    if (!bucket || now > bucket.resetAt) {
      store.set(ip, { count: 1, resetAt: now + windowMs });
      return next();
    }

    bucket.count += 1;
    if (bucket.count > maxRequests) {
      res.status(429).json({ ok: false, message: "Quá nhiều yêu cầu. Vui lòng thử lại sau." });
      return;
    }

    return next();
  };
}

// Prune stale entries every 5 minutes to prevent unbounded growth
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of store) {
    if (now > bucket.resetAt) store.delete(key);
  }
}, 5 * 60 * 1000).unref();
