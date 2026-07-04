import type { Response } from "express";
import { Redis } from "ioredis";
import logger from "./logger.js";
import { getRedis, getRedisConnectionOptions } from "./redis.js";

export type SseEventName =
  | "CONNECTED"
  | "PING"
  | "LIVE_CONNECTED"
  | "LIVE_DISCONNECTED"
  | "LIVE_ERROR"
  | "LIVE_TIME_STARTED"
  | "LIVE_TIME_ENDED"
  | "COMMENT"
  | "COMMENT_SAVED"
  | "MESSAGE"
  | "USER_JOINED"
  | "COLLECTOR_STOPPED"
  | "ORDER_SHIPPING_UPDATED"
  | "VIEWER_COUNT_UPDATE";

type SseClient = {
  id: string;
  shopId: string;
  userId: string;
  response: Response;
  connectedAt: string;
};

const SSE_CHANNEL = "sse:broadcast";

const clients = new Map<string, SseClient>();

// ponytail: separate subscriber connection — ioredis blocks in subscribe mode
let subscriber: Redis | null = null;

function getSubscriber(): Redis | null {
  const opts = getRedisConnectionOptions();
  if (!opts) return null;
  if (!subscriber) {
    subscriber = new Redis(opts);
    subscriber.subscribe(SSE_CHANNEL).catch((err) =>
      logger.warn({ err: String(err) }, "[SSE] redis subscribe failed"),
    );
    subscriber.on("message", (_channel, raw) => {
      try {
        const { shopId, event, data } = JSON.parse(raw) as {
          shopId: string;
          event: SseEventName;
          data: unknown;
        };
        deliverToLocalClients(shopId, event, data);
      } catch {
        // malformed message — ignore
      }
    });
  }
  return subscriber;
}

function writeEvent(response: Response, event: string, data: unknown) {
  response.write(`event: ${event}\n`);
  response.write(`data: ${JSON.stringify(data)}\n\n`);
}

function deliverToLocalClients(shopId: string, event: SseEventName, data: unknown) {
  let sent = 0;
  for (const client of clients.values()) {
    if (client.shopId !== shopId) continue;
    try {
      writeEvent(client.response, event, data);
      sent += 1;
    } catch {
      clients.delete(client.id);
    }
  }
  return sent;
}

export function addSseClient(client: SseClient) {
  // ensure subscriber is wired up when first client connects
  getSubscriber();

  const existing = clients.get(client.id);
  if (existing) {
    logger.debug({ clientId: client.id }, "[SSE] replacing existing connection");
    try {
      existing.response.end();
    } catch {
      // already closed
    }
    clients.delete(client.id);
  }

  clients.set(client.id, client);

  writeEvent(client.response, "CONNECTED", {
    clientId: client.id,
    shopId: client.shopId,
    connectedAt: client.connectedAt,
  });

  return () => {
    if (clients.get(client.id) === client) {
      clients.delete(client.id);
    }
  };
}

export function sendSseToClient(clientId: string, event: SseEventName, data: unknown) {
  const client = clients.get(clientId);
  if (!client) return false;
  writeEvent(client.response, event, data);
  return true;
}

export function broadcastSseToShop(shopId: string, event: SseEventName, data: unknown) {
  const publisher = getRedis();

  if (publisher) {
    // publish to Redis so all instances deliver to their local clients
    publisher
      .publish(SSE_CHANNEL, JSON.stringify({ shopId, event, data }))
      .catch((err) => logger.warn({ err: String(err) }, "[SSE] redis publish failed"));
    return 0; // delivery count unavailable cross-instance
  }

  // No Redis — deliver directly (single-instance mode)
  const sent = deliverToLocalClients(shopId, event, data);
  logger.debug({ shopId, event, sent }, "[SSE] broadcast");
  return sent;
}

export function getSseStats() {
  const byShop: Record<string, number> = {};
  for (const client of clients.values()) {
    byShop[client.shopId] = (byShop[client.shopId] || 0) + 1;
  }
  return { totalClients: clients.size, byShop };
}
