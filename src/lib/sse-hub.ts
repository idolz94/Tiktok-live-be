import type { Response } from "express";
import logger from "./logger.js";

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

const clients = new Map<string, SseClient>();

function writeEvent(response: Response, event: string, data: unknown) {
  response.write(`event: ${event}\n`);
  response.write(`data: ${JSON.stringify(data)}\n\n`);
}

export function addSseClient(client: SseClient) {
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

  logger.debug({ shopId, event, sent }, "[SSE] broadcast");
  return sent;
}

export function getSseStats() {
  const byShop: Record<string, number> = {};

  for (const client of clients.values()) {
    byShop[client.shopId] = (byShop[client.shopId] || 0) + 1;
  }

  return {
    totalClients: clients.size,
    byShop,
  };
}
