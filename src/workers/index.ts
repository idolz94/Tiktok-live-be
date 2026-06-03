import { Worker } from "bullmq";
import { env } from "../config/env.js";
import { assertRequiredEnv } from "../config/env.js";
import { getRedisConnectionOptions } from "../lib/redis.js";

assertRequiredEnv();

const connection = getRedisConnectionOptions();

if (!env.enableRedis) {
  console.log("Worker disabled. Set ENABLE_REDIS=true to run BullMQ workers.");
  process.exit(0);
}

const liveEventsWorker = new Worker(
  "live-events",
  async (job) => {
    console.log("LIVE_EVENT_JOB", job.name, job.data);
    // Chỗ này để mở rộng: AI scoring comment, tổng hợp báo cáo, gửi Telegram, cập nhật usage log...
  },
  { connection },
);

const paymentEventsWorker = new Worker(
  "payment-events",
  async (job) => {
    console.log("PAYMENT_EVENT_JOB", job.name, job.data);
    // Chỗ này để mở rộng: verify webhook payment, active license, gửi invoice...
  },
  { connection },
);

liveEventsWorker.on("failed", (job, error) => console.error("LIVE_EVENT_FAILED", job?.id, error));
paymentEventsWorker.on("failed", (job, error) => console.error("PAYMENT_EVENT_FAILED", job?.id, error));

console.log("Lumi workers are running.");
