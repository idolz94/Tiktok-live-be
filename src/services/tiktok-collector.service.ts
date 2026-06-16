import { randomUUID } from "crypto";
// @ts-ignore — tiktok-live-connector ships ESM without declaration files
import { TikTokLiveConnection, WebcastEvent, ControlEvent } from "tiktok-live-connector";
import { broadcastSseToShop } from "../lib/sse-hub.js";
import { enqueueLiveEvent } from "../lib/queues.js";
import {
  ensureCollectorLiveSession,
  findShopOwnerUserId,
  resolveShopForCollectorEvent,
} from "./internal-live-ingest.service.js";
import { endLiveSession } from "./live-sessions.service.js";
import { saveLiveComment } from "./live-comments.service.js";

// ─── Room state ───────────────────────────────────────────────────────────────

type RoomState = {
  username: string;
  shopId: string | null;
  liveSessionId: string | null;
  collectorSessionId: string;
  roomId: string | null;
  connection: any;
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
  const avatarUrl: string =
    user.profilePictureUrl || user.avatarUrl || data.profilePictureUrl || "";
  const commentText: string = data.comment || "";
  const externalCommentId = String(data.msgId || data.id || randomUUID());
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
    tiktokUsername: uniqueId,
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
    liveUsername: room.username,
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

async function ingestLiveEvent(
  room: RoomState,
  eventType: string,
  extra: Record<string, unknown> = {},
) {
  const shop = await resolveShopForCollectorEvent({
    shopId: room.shopId,
    liveUsername: room.username,
  });

  if (!shop?.id) {
    console.warn(`[TIKTOK] ${room.username} → ${eventType}: shop not found`);
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

  console.log(`[TIKTOK] ${room.username} → LIVE_CONNECTED session=${session.id}`);
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
    room.connection?.disconnect?.();
  } catch {}
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
    room.connection?.disconnect?.();
  } catch {}
}

async function onCollectorStopped(room: RoomState) {
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

  broadcastSseToShop(result.shopId, "COLLECTOR_STOPPED", payload);
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

async function connectRoom(room: RoomState) {
  const connection = new TikTokLiveConnection(room.username);
  room.connection = connection;

  connection.on(ControlEvent.DISCONNECTED, () => {
    console.log(`[TIKTOK] ${room.username} disconnected`);
    room.isRunning = false;
    onDisconnected(room).catch((e) =>
      console.error(`[TIKTOK] onDisconnected error:`, e?.message),
    );
    rooms.delete(room.username);
  });

  connection.on(ControlEvent.ERROR, (err: any) => {
    const message =
      err?.message ||
      (typeof err === "object" ? JSON.stringify(err) : String(err));
    console.error(`[TIKTOK] ${room.username} error: isRunning=${room.isRunning} isConnecting=${room.isConnecting} msg=${message}`);

    // Non-fatal if already running OR still in the process of connecting
    // (tiktok-live-connector can emit ERROR for transient issues during handshake)
    if (room.isRunning || room.isConnecting) {
      console.warn(`[TIKTOK] ${room.username} non-fatal error (running=${room.isRunning} connecting=${room.isConnecting}) — ignoring`);
      room.lastError = message;
      return;
    }

    room.lastError = message;
    room.isRunning = false;
    onError(room, message).catch((e) =>
      console.error(`[TIKTOK] onError handler error:`, e?.message),
    );
    rooms.delete(room.username);
  });

  connection.on(WebcastEvent.CHAT, (data: any) => {
    room.commentCount += 1;
    room.lastCommentAt = nowIso();
    ingestComment(room, data).catch((e) =>
      console.error(`[TIKTOK] ingestComment error:`, e?.message),
    );
  });

  connection.on(WebcastEvent.ROOM_USER, (data: any) => {
    const viewersCount =
      typeof data.viewerCount === "number" ? data.viewerCount : 0;
    onViewerCount(room, viewersCount).catch(() => {});
  });

  connection.on(WebcastEvent.MEMBER, (data: any) => {
    onUserJoined(room, data).catch(() => {});
  });

  console.log(`[TIKTOK] ${room.username} calling connection.connect()...`);
  const state = await connection.connect();
  room.roomId = state?.roomId || null;
  room.isRunning = true;
  room.isConnecting = false;
  console.log(`[TIKTOK] ${room.username} connected — roomId=${room.roomId} isRunning=${room.isRunning}`);

  await onConnected(room, room.roomId);
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
    isConnecting: true,
    isRunning: false,
    isStopping: false,
    startedAt: nowIso(),
    lastCommentAt: null,
    commentCount: 0,
    lastError: null,
  };

  rooms.set(normalized, room);

  console.log(`[TIKTOK] startTikTokCollector @${normalized} shopId=${shopId}`);
  connectRoom(room).catch((err) => {
    const message = err?.message || String(err);
    console.error(`[TIKTOK] connectRoom failed for ${normalized}:`, message);
    room.isConnecting = false;
    room.isRunning = false;
    room.lastError = message;
    rooms.delete(normalized);
  });

  return {
    ok: true,
    message: `Collector starting for @${normalized}`,
    collectorSessionId: room.collectorSessionId,
    username: normalized,
  };
}

export async function stopTikTokCollector({ username }: { username: string }) {
  const normalized = username.replace(/^@/, "").trim().toLowerCase();
  const room = rooms.get(normalized);

  if (!room) {
    return { ok: true, message: "Collector not running", username: normalized };
  }

  room.isStopping = true;
  room.isRunning = false;

  await onCollectorStopped(room);

  try {
    room.connection?.disconnect?.();
  } catch {}

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
