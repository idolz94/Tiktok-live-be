import { randomUUID } from "crypto";
import {
  ClientCloseCode,
  type ClientMessageBundle,
  type DecodedData,
  createWebSocketUrl,
} from "@eulerstream/euler-websocket-sdk";
import { broadcastSseToShop } from "../lib/sse-hub.js";
import { enqueueLiveEvent } from "../lib/queues.js";
import logger from "../lib/logger.js";
import { env } from "../config/env.js";
import {
  ensureCollectorLiveSession,
  findShopOwnerUserId,
  resolveShopForCollectorEvent,
} from "./internal-live-ingest.service.js";
import { endLiveSession } from "./live-sessions.service.js";
import { saveLiveComment } from "./live-comments.service.js";
import { updateTikTokChannelProfile } from "./tiktok-channels.service.js";

// ─── Room state ───────────────────────────────────────────────────────────────

type RoomState = {
  username: string;
  shopId: string | null;
  liveSessionId: string | null;
  collectorSessionId: string;
  roomId: string | null;
  connection: WebSocket | null;
  reconnectTimer: NodeJS.Timeout | null;
  hasEmittedConnected: boolean;
  isConnecting: boolean;
  isRunning: boolean;
  isStopping: boolean;
  startedAt: string;
  lastCommentAt: string | null;
  commentCount: number;
  lastError: string | null;
};

const rooms = new Map<string, RoomState>();

function nowIso() {
  return new Date().toISOString();
}

// ─── Ingest helpers (direct calls — no HTTP) ─────────────────────────────────

async function ingestComment(room: RoomState, data: any) {
  if (!room.isRunning) return;

  const user = data.user || {};
  const uniqueId: string = user.uniqueId || data.uniqueId || "";
  const nickname: string = user.nickname || data.nickname || uniqueId;
  const profilePicUrls = user.profilePicture?.url;
  const avatarUrl: string =
    (Array.isArray(profilePicUrls) ? profilePicUrls[0] : profilePicUrls) ||
    user.profilePictureUrl || user.avatarUrl || data.profilePictureUrl || "";
  const commentText: string = data.comment || "";
  const externalCommentId = String(data.common?.msgId || data.msgId || data.id || randomUUID());
  const createdAt = nowIso();

  const shop = await resolveShopForCollectorEvent({
    shopId: room.shopId,
    liveUsername: room.username,
  });

  if (!shop?.id) return;

  const session = await ensureCollectorLiveSession({
    shopId: shop.id,
    liveUsername: room.username,
    collectorSessionId: room.collectorSessionId,
    startedAt: createdAt,
  });

  const commentPayload = {
    id: externalCommentId,
    externalCommentId,
    shopId: shop.id,
    liveSessionId: session.id,
    tiktokUsername: uniqueId.replace(/^@/, ""),
    displayName: nickname,
    avatarUrl,
    commentText,
    text: commentText,
    intent: "normal",
    priorityLevel: "normal",
    finalScore: 0,
    isOrderCreated: false,
    createdAt,
    rawPayload: data,
  };

  const comment = await saveLiveComment({
    shopId: shop.id,
    liveSessionId: session.id,
    comment: commentPayload,
    liveUsername: room.username,
  });

  if (!comment) return;

  const realtimePayload = {
    eventId: externalCommentId,
    eventType: "COMMENT",
    source: "node-tiktok-collector",
    shopId: shop.id,
    liveSessionId: session.id,
    live_session_id: session.id,
    collectorSessionId: room.collectorSessionId,
    liveUsername: room.username.replace(/^@/, ""),
    comment: {
      ...commentPayload,
      intent: comment.intent,
      priorityLevel: comment.priorityLevel,
      finalScore: comment.finalScore,
      canCreateOrder: comment.canCreateOrder,
      id: comment.id,
      dbId: comment.id,
    },
    createdAt,
  };

  broadcastSseToShop(shop.id, "COMMENT", realtimePayload);

  await enqueueLiveEvent("comment-saved", {
    shopId: shop.id,
    liveSessionId: session.id,
    commentId: comment.id,
    externalCommentId: comment.externalCommentId,
  });
}

async function ingestLiveEvent(room: RoomState, eventType: string) {
  const shop = await resolveShopForCollectorEvent({
    shopId: room.shopId,
    liveUsername: room.username,
  });

  if (!shop?.id) {
    logger.warn(`[TIKTOK] ${room.username} → ${eventType}: shop not found`);
    return null;
  }

  return { shop, shopId: shop.id };
}

// ─── Event handlers ───────────────────────────────────────────────────────────

async function onConnected(room: RoomState, roomId: string | null) {
  const createdAt = nowIso();
  const result = await ingestLiveEvent(room, "LIVE_CONNECTED");
  if (!result) return;

  const session = await ensureCollectorLiveSession({
    shopId: result.shopId,
    liveUsername: room.username,
    collectorSessionId: room.collectorSessionId,
    startedAt: createdAt,
  });

  const payload = {
    shopId: result.shopId,
    liveSessionId: session.id,
    live_session_id: session.id,
    collectorSessionId: room.collectorSessionId,
    liveUsername: room.username,
    roomId,
    startedAt: session.startedAt || createdAt,
    createdAt,
  };

  broadcastSseToShop(result.shopId, "LIVE_CONNECTED", payload);
  await enqueueLiveEvent("collector-live-connected", payload);

  logger.debug({ username: room.username, sessionId: session.id }, "[TIKTOK] LIVE_CONNECTED");
}

async function onDisconnected(room: RoomState) {
  if (room.isStopping) return;

  const endedAt = nowIso();
  const result = await ingestLiveEvent(room, "LIVE_DISCONNECTED");
  if (!result) return;

  const ownerUserId = await findShopOwnerUserId(result.shopId);
  if (!ownerUserId) return;

  const session = await endLiveSession({
    shopId: result.shopId,
    userId: ownerUserId,
    sessionId: room.collectorSessionId,
    username: room.username,
    endedAt,
    commentCount: room.commentCount,
    reason: "live_disconnected",
  });

  const payload = {
    shopId: result.shopId,
    liveSessionId: session?.id || null,
    live_session_id: session?.id || null,
    collectorSessionId: room.collectorSessionId,
    liveUsername: room.username,
    reason: "live_disconnected",
    endedAt,
    createdAt: endedAt,
    status: "ended",
    durationSeconds: session?.durationSeconds || 0,
    commentCount: room.commentCount,
  };

  broadcastSseToShop(result.shopId, "LIVE_DISCONNECTED", payload);
  await enqueueLiveEvent("collector-live-disconnected", payload);

  try {
    room.connection?.close?.();
  } catch {
    // ignore disconnect errors
  }
}

async function onError(room: RoomState, message: string) {
  const createdAt = nowIso();
  const result = await ingestLiveEvent(room, "LIVE_ERROR");
  if (!result) return;

  const ownerUserId = await findShopOwnerUserId(result.shopId);
  let session: any = null;

  if (ownerUserId) {
    session = await endLiveSession({
      shopId: result.shopId,
      userId: ownerUserId,
      sessionId: room.collectorSessionId,
      username: room.username,
      endedAt: createdAt,
      commentCount: room.commentCount,
      reason: "collector_error",
    });
  }

  const payload = {
    shopId: result.shopId,
    liveSessionId: session?.id || null,
    live_session_id: session?.id || null,
    collectorSessionId: room.collectorSessionId,
    liveUsername: room.username,
    message,
    reason: "collector_error",
    shouldStop: true,
    retry: false,
    createdAt,
    endedAt: createdAt,
    status: "ended",
    durationSeconds: session?.durationSeconds || 0,
  };

  broadcastSseToShop(result.shopId, "LIVE_ERROR", payload);
  await enqueueLiveEvent("collector-live-error", payload);

  try {
    room.connection?.close?.();
  } catch {
    // ignore disconnect errors
  }
}

async function onCollectorStopped(room: RoomState, options?: { silent?: boolean }) {
  const endedAt = nowIso();
  const result = await ingestLiveEvent(room, "COLLECTOR_STOPPED");
  if (!result) return;

  const ownerUserId = await findShopOwnerUserId(result.shopId);
  let session: any = null;

  if (ownerUserId) {
    session = await endLiveSession({
      shopId: result.shopId,
      userId: ownerUserId,
      sessionId: room.collectorSessionId,
      username: room.username,
      endedAt,
      commentCount: room.commentCount,
      reason: "manual_stop",
    });
  }

  const payload = {
    shopId: result.shopId,
    liveSessionId: session?.id || null,
    live_session_id: session?.id || null,
    collectorSessionId: room.collectorSessionId,
    liveUsername: room.username,
    reason: "manual_stop",
    endedAt,
    createdAt: endedAt,
    status: "ended",
    durationSeconds: session?.durationSeconds || 0,
    commentCount: room.commentCount,
  };

  if (!options?.silent) {
    broadcastSseToShop(result.shopId, "COLLECTOR_STOPPED", payload);
  }
  await enqueueLiveEvent("collector-stopped", payload);
}

async function onViewerCount(room: RoomState, viewersCount: number) {
  const shop = await resolveShopForCollectorEvent({
    shopId: room.shopId,
    liveUsername: room.username,
  });

  if (!shop?.id) return;

  broadcastSseToShop(shop.id, "VIEWER_COUNT_UPDATE", {
    shopId: shop.id,
    liveUsername: room.username,
    viewersCount,
    createdAt: nowIso(),
  });
}

async function onUserJoined(room: RoomState, data: any) {
  const user = data.user || {};
  const joinUsername: string = user.uniqueId || data.uniqueId || "";
  const joinDisplayName: string = user.nickname || data.nickname || joinUsername;
  const joinAvatarUrl: string =
    user.profilePictureUrl || user.avatarUrl || data.profilePictureUrl || "";

  const shop = await resolveShopForCollectorEvent({
    shopId: room.shopId,
    liveUsername: room.username,
  });

  if (!shop?.id) return;

  broadcastSseToShop(shop.id, "USER_JOINED", {
    shopId: shop.id,
    liveUsername: room.username,
    nickname: joinDisplayName,
    joinUsername,
    joinDisplayName,
    joinAvatarUrl,
    createdAt: nowIso(),
  });
}

// ─── Room lifecycle ───────────────────────────────────────────────────────────

function isBundle(message: DecodedData | ClientMessageBundle): message is ClientMessageBundle {
  return Array.isArray((message as ClientMessageBundle).messages);
}

function parseEulerFrame(raw: string): DecodedData[] {
  const parsed = JSON.parse(raw) as DecodedData | ClientMessageBundle;
  return isBundle(parsed) ? parsed.messages : [parsed];
}

function emitConnectedOnce(room: RoomState, roomId: string | null) {
  if (room.hasEmittedConnected) return;
  room.hasEmittedConnected = true;
  room.roomId = roomId;
  room.isRunning = true;
  room.isConnecting = false;
  onConnected(room, roomId).catch((e) =>
    logger.error({ err: e?.message }, "[TIKTOK] onConnected error"),
  );
}

function updateProfileFromRoomInfo(room: RoomState, roomInfo: any) {
  if (!room.shopId) return;
  const owner = roomInfo?.data?.owner ?? roomInfo?.data?.user ?? roomInfo?.owner ?? roomInfo?.user;
  if (!owner) return;

  const displayName: string | null = owner.nickname ?? null;
  const avatarUrl: string | null = owner.avatarThumb?.urlList?.[0] ?? owner.avatarThumb?.url ?? null;
  const followerCount: number | null =
    typeof owner.followInfo?.followerCount === "number"
      ? owner.followInfo.followerCount
      : typeof owner.followInfo?.followerCount === "string"
        ? parseInt(owner.followInfo.followerCount, 10) || null
        : null;

  updateTikTokChannelProfile(room.shopId, room.username, { displayName, avatarUrl, followerCount }).catch(
    (e) => logger.warn({ err: e?.message }, "[TIKTOK] updateTikTokChannelProfile failed"),
  );
}

function handleEulerEvent(room: RoomState, event: DecodedData) {
  switch (event.type) {
    case "tiktok.connect":
      emitConnectedOnce(room, room.roomId);
      break;
    case "roomInfo":
      updateProfileFromRoomInfo(room, event);
      break;
    case "WebcastChatMessage":
      room.commentCount += 1;
      room.lastCommentAt = nowIso();
      ingestComment(room, event.data).catch((e) =>
        logger.error({ err: e?.message }, "[TIKTOK] ingestComment error"),
      );
      break;
    case "WebcastMemberMessage":
      onUserJoined(room, event.data).catch(() => {});
      break;
    case "WebcastRoomUserSeqMessage": {
      const data = event.data as any;
      const viewersCount = typeof data.viewerCount === "number" ? data.viewerCount : 0;
      onViewerCount(room, viewersCount).catch(() => {});
      break;
    }
  }
}

function shouldReconnect(code: number) {
  return [
    ClientCloseCode.NO_MESSAGES_TIMEOUT,
    ClientCloseCode.TIKTOK_CLOSED_CONNECTION,
    ClientCloseCode.INTERNAL_SERVER_ERROR,
    ClientCloseCode.MAX_LIFETIME_EXCEEDED,
    ClientCloseCode.WEBCAST_FETCH_ERROR, // transient TikTok API timeout — retry
  ].includes(code);
}

function reconnectRoom(room: RoomState) {
  if (room.isStopping || !rooms.has(room.username)) return;
  room.reconnectTimer = setTimeout(() => {
    room.reconnectTimer = null;
    connectRoom(room).catch((e) => logger.error({ err: e?.message }, "[TIKTOK] reconnect failed"));
  }, 3000);
}

async function handleEulerClose(room: RoomState, code: number, reason: string) {
  logger.debug({ username: room.username, code, reason }, "[TIKTOK] websocket closed");
  room.connection = null;

  if (room.isStopping) return;
  if (shouldReconnect(code)) {
    room.isConnecting = true;
    reconnectRoom(room);
    return;
  }

  room.isRunning = false;
  room.isConnecting = false;

  if (!room.hasEmittedConnected && code === ClientCloseCode.NOT_LIVE) {
    rooms.delete(room.username);
    throw new Error("TikTok chưa bật live");
  }

  if (code === ClientCloseCode.NOT_LIVE || code === ClientCloseCode.STREAM_END) {
    await onDisconnected(room);
  } else {
    await onError(room, reason || `Euler closed with code ${code}`);
  }
  rooms.delete(room.username);
}

async function connectRoom(room: RoomState) {
  const url = createWebSocketUrl({
    uniqueId: room.username,
    apiKey: env.eulerApiKey,
    features: { bundleEvents: true },
  });
  const connection = new WebSocket(url);
  room.connection = connection;

  connection.addEventListener("open", () => {
    logger.debug({ username: room.username }, "[TIKTOK] websocket opened");
  });

  connection.addEventListener("message", (event) => {
    try {
      const raw = typeof event.data === "string" ? event.data : Buffer.from(event.data as ArrayBuffer).toString("utf8");
      for (const message of parseEulerFrame(raw)) handleEulerEvent(room, message);
    } catch (e: any) {
      logger.error({ username: room.username, err: e?.message }, "[TIKTOK] websocket message error");
    }
  });

  connection.addEventListener("error", () => {
    room.lastError = "Euler WebSocket error";
    logger.warn({ username: room.username }, "[TIKTOK] websocket error");
  });

  connection.addEventListener("close", (event) => {
    handleEulerClose(room, event.code, event.reason).catch((e) => {
      room.lastError = e?.message || String(e);
      room.isRunning = false;
      room.isConnecting = false;
      rooms.delete(room.username);
      logger.error({ username: room.username, err: room.lastError }, "[TIKTOK] websocket close handler failed");
    });
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function startTikTokCollector({
  username,
  shopId,
  liveSessionId,
}: {
  username: string;
  shopId?: string | null;
  liveSessionId?: string | null;
}) {
  const normalized = username.replace(/^@/, "").trim().toLowerCase();

  if (rooms.has(normalized)) {
    const existing = rooms.get(normalized)!;
    return {
      ok: true,
      message: "Collector already running",
      collectorSessionId: existing.collectorSessionId,
      username: normalized,
    };
  }

  const room: RoomState = {
    username: normalized,
    shopId: shopId || null,
    liveSessionId: liveSessionId || null,
    collectorSessionId: randomUUID(),
    roomId: null,
    connection: null,
    reconnectTimer: null,
    hasEmittedConnected: false,
    isConnecting: true,
    isRunning: false,
    isStopping: false,
    startedAt: nowIso(),
    lastCommentAt: null,
    commentCount: 0,
    lastError: null,
  };

  rooms.set(normalized, room);

  logger.debug({ username: normalized, shopId }, "[TIKTOK] startTikTokCollector");
  connectRoom(room).catch((err) => {
    const message = err?.message || String(err);
    logger.error({ username: normalized, err: message }, "[TIKTOK] connectRoom failed");
    room.isConnecting = false;
    room.isRunning = false;
    room.lastError = message;
    rooms.delete(normalized);

    if (room.shopId) {
      const isOffline =
        message.toLowerCase().includes("online") ||
        message.toLowerCase().includes("offline");
      const friendlyMessage = isOffline ? "TikTok chưa bật live" : message;
      const createdAt = nowIso();
      broadcastSseToShop(room.shopId, "LIVE_ERROR", {
        shopId: room.shopId,
        liveSessionId: null,
        live_session_id: null,
        collectorSessionId: room.collectorSessionId,
        liveUsername: room.username,
        message: friendlyMessage,
        reason: "connect_failed",
        shouldStop: true,
        retry: false,
        createdAt,
        endedAt: createdAt,
        status: "ended",
        durationSeconds: 0,
      });
    }
  });

  return {
    ok: true,
    message: `Collector starting for @${normalized}`,
    collectorSessionId: room.collectorSessionId,
    username: normalized,
  };
}

export async function stopTikTokCollector({
  username,
  silent,
}: {
  username: string;
  silent?: boolean;
}) {
  const normalized = username.replace(/^@/, "").trim().toLowerCase();
  const room = rooms.get(normalized);

  if (!room) {
    return { ok: true, message: "Collector not running", username: normalized };
  }

  room.isStopping = true;
  room.isRunning = false;

  if (silent) {
    // Return immediately; run DB cleanup in background without broadcasting SSE.
    onCollectorStopped(room, { silent: true }).catch(() => {});
  } else {
    await onCollectorStopped(room);
  }

  if (room.reconnectTimer) {
    clearTimeout(room.reconnectTimer);
    room.reconnectTimer = null;
  }

  try {
    room.connection?.close?.();
  } catch {
    // ignore disconnect errors
  }

  rooms.delete(normalized);

  return {
    ok: true,
    message: `Collector stopped for @${normalized}`,
    username: normalized,
  };
}

export function listTikTokCollectors() {
  return [...rooms.values()].map((r) => ({
    username: r.username,
    shopId: r.shopId,
    liveSessionId: r.liveSessionId,
    collectorSessionId: r.collectorSessionId,
    roomId: r.roomId,
    isRunning: r.isRunning,
    isStopping: r.isStopping,
    commentCount: r.commentCount,
    startedAt: r.startedAt,
    lastCommentAt: r.lastCommentAt,
    lastError: r.lastError,
  }));
}
