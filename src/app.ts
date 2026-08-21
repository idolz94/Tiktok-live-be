import type { NextFunction, Request, Response } from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { env } from "./config/env.js";
import { errorHandler, notFoundHandler } from "./middlewares/error.js";
import { requestId } from "./middlewares/request-id.js";
import authRoutes from "./routes/auth.routes.js";
import customersRoutes from "./routes/customers.routes.js";
import customerAddressesRoutes from "./routes/customer-addresses.routes.js";
import shopAddressesRoutes from "./routes/shop-addresses.routes.js";
import licenseRoutes from "./routes/license.routes.js";
import buyingIntentQueueRoutes from "./routes/buying-intent-queue.routes.js";
import liveCommentsRoutes from "./routes/live-comments.routes.js";
import liveSessionsRoutes from "./routes/live-sessions.routes.js";
import liveStreamRoutes from "./routes/live-stream.routes.js";
import meRoutes from "./routes/me.routes.js";
import ordersRoutes from "./routes/orders.routes.js";
import paymentRoutes from "./routes/payment.routes.js";
import shopSettingsRoutes from "./routes/shop-settings.routes.js";
import productPresetsRoutes from "./routes/product-presets.routes.js";
import webhookSpxRoutes from "./routes/webhook-spx.routes.js";
import internalLiveRoutes from "./routes/internal-live.routes.js";
import adminRoutes from "./routes/admin.routes.js";
import shipmentsRoutes from "./routes/shipments.routes.js";

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
  app.use(requestId);
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

  // Registered before requireKnownClient — providers send server-side POST without Origin header
  app.use("/api/webhooks/spx", webhookSpxRoutes);

  app.use(requireKnownClient);

  app.get("/health", (_request, response) => {
    response.json({ ok: true, service: "lumi-backend", time: new Date().toISOString() });
  });

  app.use("/api/auth", authRoutes);
  app.use("/api/me", meRoutes);
  app.use("/api/orders", ordersRoutes);
  app.use("/api/customers", customersRoutes);
  app.use("/api/customers/:customerId/addresses", customerAddressesRoutes);
  app.use("/api/shipments", shipmentsRoutes);
  app.use("/api/me/shop-addresses", shopAddressesRoutes);
  app.use("/api/live-comments", liveCommentsRoutes);
  app.use("/api/live-sessions", liveSessionsRoutes);
  app.use("/api/live-stream", liveStreamRoutes);
  app.use("/api/live-intent-queue", buyingIntentQueueRoutes);

  app.use("/api/licenses", licenseRoutes);
  app.use("/api/payments", paymentRoutes);
  app.use("/api/me/shop-settings", shopSettingsRoutes);
  app.use("/api/me/product-presets", productPresetsRoutes);
  app.use("/api/admin", adminRoutes);
  app.use("/api/internal", internalLiveRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
