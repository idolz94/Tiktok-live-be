import { Queue } from "bullmq";
import { getRedisConnectionOptions } from "./redis.js";

export type QueueName = "live-events" | "payment-events";

const queues = new Map<QueueName, Queue>();

export function getQueue(name: QueueName) {
  const connection = getRedisConnectionOptions();
  if (!connection) return null;

  const cached = queues.get(name);
  if (cached) return cached;

  const queue = new Queue(name, { connection });
  queues.set(name, queue);
  return queue;
}

export async function enqueueLiveEvent(name: string, data: Record<string, unknown>) {
  const queue = getQueue("live-events");
  if (!queue) return null;
  return queue.add(name, data, { attempts: 3, backoff: { type: "exponential", delay: 3000 } });
}

export async function enqueuePaymentEvent(name: string, data: Record<string, unknown>) {
  const queue = getQueue("payment-events");
  if (!queue) return null;
  return queue.add(name, data, { attempts: 3, backoff: { type: "exponential", delay: 3000 } });
}
