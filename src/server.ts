import { createApp } from "./app.js";
import { assertRequiredEnv, env } from "./config/env.js";
import logger from "./lib/logger.js";
import { pool } from "./lib/db.js";
import { expireOldLicenses } from "./services/license.service.js";

assertRequiredEnv();

const app = createApp();

const server = app.listen(env.port, () => {
  logger.info(`Lumi backend is running at http://localhost:${env.port}`);

  // ponytail: run once at startup then every hour — no external scheduler needed
  expireOldLicenses().catch(() => {});
  setInterval(() => expireOldLicenses().catch(() => {}), 60 * 60 * 1000);
});

async function shutdown(signal: string) {
  logger.info({ signal }, "Graceful shutdown started");
  server.close(async () => {
    logger.info("Shutdown complete");
    process.exit(0);
  });

  setTimeout(() => process.exit(1), 15_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
