import { Redis } from "ioredis";
import { env } from "../config/env.js";

let redis: Redis | null = null;

export function getRedisConnectionOptions() {
  const url = new URL(env.redisUrl);

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
  if (!env.enableRedis) return null;

  if (!redis) {
    redis = new Redis(getRedisConnectionOptions());
  }

  return redis;
}
