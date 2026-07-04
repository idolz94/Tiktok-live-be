import { createApp } from "./app.js";
import { assertRequiredEnv, env } from "./config/env.js";
import logger from "./lib/logger.js";
import { expireOldLicenses } from "./services/license.service.js";

assertRequiredEnv();

const app = createApp();

app.listen(env.port, () => {
  logger.info(`Lumi backend is running at http://localhost:${env.port}`);

  // ponytail: run once at startup then every hour — no external scheduler needed
  expireOldLicenses().catch(() => {});
  setInterval(() => expireOldLicenses().catch(() => {}), 60 * 60 * 1000);
});
