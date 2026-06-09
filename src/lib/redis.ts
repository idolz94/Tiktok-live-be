import { Redis } from "ioredis";

const REDIS_URL = process.env.REDIS_URL || "";

let redis: Redis | null = null;

export function getRedisConnectionOptions() {
  if (!REDIS_URL) return null;

  const url = new URL(REDIS_URL);

  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password || undefined,
    db: url.pathname ? Number(url.pathname.replace("/", "") || 0) : 0,
    maxRetriesPerRequest: null,
  };
}

export function getRedis() {
  if (!REDIS_URL) return null;

  if (!redis) {
    redis = new Redis(getRedisConnectionOptions()!);
  }

  return redis;
}
