import type { NextFunction, Request, Response } from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { env } from "./config/env.js";
import { errorHandler, notFoundHandler } from "./middlewares/error.js";
import authRoutes from "./routes/auth.routes.js";
import customersRoutes from "./routes/customers.routes.js";
import licenseRoutes from "./routes/license.routes.js";
import internalLiveCommentsRoutes from "./routes/internal-live-comments.routes.js";
import internalLiveEventsRoutes from "./routes/internal-live-events.routes.js";
import liveCommentsRoutes from "./routes/live-comments.routes.js";
import liveSessionsRoutes from "./routes/live-sessions.routes.js";
import liveStreamRoutes from "./routes/live-stream.routes.js";
import meRoutes from "./routes/me.routes.js";
import ordersRoutes from "./routes/orders.routes.js";
import paymentRoutes from "./routes/payment.routes.js";

const allowedOrigins = env.clientOrigin
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

function isAllowedOrigin(origin?: string) {
  if (!origin) return true;
  if (env.clientOrigin === "*") return true;
  return allowedOrigins.includes(origin);
}

function requireKnownClient(request: Request, response: Response, next: NextFunction) {
  if (request.headers.origin || request.path.startsWith("/api/internal/")) {
    next();
    return;
  }

  const appKey = String(request.headers["x-app-key"] || "");
  if (env.mobileAppKey && appKey === env.mobileAppKey) {
    next();
    return;
  }

  response.status(403).json({ ok: false, message: "Client không được phép gọi API." });
}

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin(origin, callback) {
        callback(null, isAllowedOrigin(origin));
      },
      credentials: true,
    }),
  );
  app.use(express.json({ limit: "2mb" }));
  app.use(cookieParser());
  app.use(morgan(env.nodeEnv === "production" ? "combined" : "dev"));
  app.use(requireKnownClient);

  app.get("/health", (_request, response) => {
    response.json({ ok: true, service: "lumi-backend", time: new Date().toISOString() });
  });

  app.use("/api/auth", authRoutes);
  app.use("/api/me", meRoutes);
  app.use("/api/orders", ordersRoutes);
  app.use("/api/customers", customersRoutes);
  app.use("/api/live-comments", liveCommentsRoutes);
  app.use("/api/live-sessions", liveSessionsRoutes);
  app.use("/api/live-stream", liveStreamRoutes);

  // Python TikTok Collector posts comments here. Protected by x-internal-api-key.
  app.use("/api/internal/live-comments", internalLiveCommentsRoutes);
  app.use("/api/internal/live-events", internalLiveEventsRoutes);
  app.use("/api/licenses", licenseRoutes);
  app.use("/api/payments", paymentRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
