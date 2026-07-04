import { Worker } from "bullmq";
import { assertRequiredEnv } from "../config/env.js";
import logger from "../lib/logger.js";
import { getRedisConnectionOptions } from "../lib/redis.js";

assertRequiredEnv();

const connection = getRedisConnectionOptions();

if (!connection) {
  logger.warn("Worker disabled. Set REDIS_URL to run BullMQ workers.");
  process.exit(0);
}

const workerOpts = {
  connection,
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 500 },
};

const liveEventsWorker = new Worker(
  "live-events",
  async (job) => {
    logger.info({ name: job.name, data: job.data }, "LIVE_EVENT_JOB");
    // Chỗ này để mở rộng: AI scoring comment, tổng hợp báo cáo, gửi Telegram, cập nhật usage log...
  },
  workerOpts,
);

const paymentEventsWorker = new Worker(
  "payment-events",
  async (job) => {
    logger.info({ name: job.name, data: job.data }, "PAYMENT_EVENT_JOB");
    // Chỗ này để mở rộng: verify webhook payment, active license, gửi invoice...
  },
  workerOpts,
);

liveEventsWorker.on("failed", (job, error) => logger.error({ jobId: job?.id, err: error }, "LIVE_EVENT_FAILED"));
paymentEventsWorker.on("failed", (job, error) => logger.error({ jobId: job?.id, err: error }, "PAYMENT_EVENT_FAILED"));

logger.info("Lumi workers are running.");
