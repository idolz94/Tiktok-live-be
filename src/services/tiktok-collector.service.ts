import { randomUUID } from "crypto";
import {
  ClientCloseCode,
  type ClientMessageBundle,
  type DecodedData,
  createWebSocketUrl,
} from "@eulerstream/euler-websocket-sdk";
import { broadcastSseToShop, sendSseToUser } from "../lib/sse-hub.js";
import { enqueueLiveEvent } from "../lib/queues.js";
import logger from "../lib/logger.js";
import { env } from "../config/env.js";
import {
  ensureCollectorLiveSession,
  findShopOwnerUserId,
  resolveShopForCollectorEvent,
} from "./internal-live-ingest.service.js";
import { endLiveSession } from "./live-sessions.service.js";
import { upsertBuyingIntentQueueFromComment, updateBuyingIntentQueueStatus } from "./buying-intent-queue.service.js";
import { saveLiveComment } from "./live-comments.service.js";
import { matchPresetByComment } from "./product-presets.service.js";
import { createOrderFromComment } from "./orders.service.js";
import { updateTikTokChannelProfile } from "./tiktok-channels.service.js";

// ─── Room state ───────────────────────────────────────────────────────────────

type RoomState = {
  username: string;
  shopId: string | null;
  userId: string | null;
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
  // ponytail: reconnect-with-grace — thay vì end session ngay khi Euler đóng socket,
  // room vào trạng thái "reconnecting" và retry trong 1 cửa sổ; chỉ hết cửa sổ mới end thật.
  reconnectAttempts: number;
  reconnectWindowStartedAt: number | null;
  // ponytail: cache resolve shop/session — trước đây MỖI comment gọi lại
  // resolveShopForCollectorEvent + ensureCollectorLiveSession (2+ query/comment); live đông
  // comment là nghẽn event loop → miss ping → tự rớt. Room sống thì shop/session không đổi.
  resolvedShopId: string | null;
  cachedSessionId: string | null;
};

const rooms = new Map<string, RoomState>();

// ─── Reconnect policy ────────────────────────────────────────────────────────
// Euler close codes chia 3 nhóm:
// - live thật sự kết thúc: STREAM_END, NOT_LIVE (sau khi đã từng connect)
// - lỗi vĩnh viễn (retry vô ích): INVALID_OPTIONS/INVALID_AUTH/NO_PERMISSION
// - còn lại (kể cả 1006 network blip, TOO_MANY_CONNECTIONS, MAX_LIFETIME 8h...): transient → retry.
const RECONNECT_GRACE_WINDOW_MS = 5 * 60 * 1000;
const RECONNECT_DELAYS_MS = [3_000, 6_000, 12_000, 24_000, 48_000, 90_000];
// TOO_MANY_CONNECTIONS = rate limit phía Euler — retry sớm chỉ làm tệ hơn.
const RATE_LIMIT_MIN_DELAY_MS = 30_000;

const FATAL_CLOSE_CODES: number[] = [
  ClientCloseCode.INVALID_OPTIONS,
  ClientCloseCode.INVALID_AUTH,
  ClientCloseCode.NO_PERMISSION,
];

// ─── Auto draft order (hybrid tier) ──────────────────────────────────────────
// ponytail: điểm RẤT cao (mặc định ≥90) + match được preset + đủ thông tin → tự tạo đơn nháp,
// seller chỉ review. Điểm 85–89 vẫn đi đường ORDER_RECOMMENDED (seller bấm tay) như cũ.
// Draft là trạng thái đảo ngược được nên auto ở mức nháp an toàn; tắt bằng LIVE_AUTO_DRAFT_ORDER=false.
const AUTO_DRAFT_ORDER_ENABLED = (process.env.LIVE_AUTO_DRAFT_ORDER ?? "true") !== "false";
const AUTO_DRAFT_MIN_SCORE = Number(process.env.LIVE_AUTO_DRAFT_MIN_SCORE ?? 90);
const RECOMMEND_MIN_SCORE = 85;

function roomKey(username: string, shopId?: string | null, userId?: string | null) {
  return `${shopId || "global"}:${userId || "global"}:${username}`;
}

function nowIso() {
  return new Date().toISOString();
}

function sendRoomSse(room: RoomState, shopId: string, event: Parameters<typeof broadcastSseToShop>[1], payload: unknown) {
  if (room.userId) return sendSseToUser(room.userId, event, payload);
  return broadcastSseToShop(shopId, event, payload);
}

// ponytail: shop của room không đổi trong suốt vòng đời — resolve 1 lần, cache lại.
async function resolveRoomShopId(room: RoomState): Promise<string | null> {
  if (room.resolvedShopId) return room.resolvedShopId;
  const shop = await resolveShopForCollectorEvent({
    shopId: room.shopId,
    liveUsername: room.username,
  });
  if (shop?.id) room.resolvedShopId = shop.id;
  return shop?.id ?? null;
}

function emitReconnecting(room: RoomState, info: { attempt: number; code: number; reason: string; nextRetryMs: number }) {
  resolveRoomShopId(room)
    .then((shopId) => {
      if (!shopId) return;
      sendRoomSse(room, shopId, "LIVE_RECONNECTING", {
        shopId,
        liveSessionId: room.cachedSessionId,
        live_session_id: room.cachedSessionId,
        collectorSessionId: room.collectorSessionId,
        liveUsername: room.username,
        attempt: info.attempt,
        closeCode: info.code,
        reason: info.reason,
        nextRetryMs: info.nextRetryMs,
        createdAt: nowIso(),
      });
    })
    .catch(() => {});
}

function emitReconnected(room: RoomState) {
  resolveRoomShopId(room)
    .then((shopId) => {
      if (!shopId) return;
      sendRoomSse(room, shopId, "LIVE_RECONNECTED", {
        shopId,
        liveSessionId: room.cachedSessionId,
        live_session_id: room.cachedSessionId,
        collectorSessionId: room.collectorSessionId,
        liveUsername: room.username,
        createdAt: nowIso(),
      });
    })
    .catch(() => {});
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

  const shopId = await resolveRoomShopId(room);
  if (!shopId) return;

  // ponytail: ensure session 1 lần cho cả room thay vì mỗi comment — id không đổi khi room còn sống.
  let sessionId = room.cachedSessionId;
  if (!sessionId) {
    const session = await ensureCollectorLiveSession({
      shopId,
      userId: room.userId,
      liveUsername: room.username,
      collectorSessionId: room.collectorSessionId,
      startedAt: createdAt,
    });
    sessionId = session.id;
    room.cachedSessionId = sessionId;
  }

  const commentPayload = {
    id: externalCommentId,
    externalCommentId,
    shopId,
    liveSessionId: sessionId,
    tiktokUsername: uniqueId.replace(/^@/, ""),
    displayName: nickname,
    avatarUrl,
    commentText,
    text: commentText,
    isOrderCreated: false,
    createdAt,
    rawPayload: data,
  };

  const comment = await saveLiveComment({
    shopId: shopId,
    liveSessionId: sessionId,
    comment: commentPayload,
    liveUsername: room.username,
  });

  if (!comment) return;

  const realtimePayload = {
    eventId: externalCommentId,
    eventType: "COMMENT",
    source: "node-tiktok-collector",
    shopId: shopId,
    liveSessionId: sessionId,
    live_session_id: sessionId,
    collectorSessionId: room.collectorSessionId,
    liveUsername: room.username.replace(/^@/, ""),
    comment: {
      ...commentPayload,
      intent: comment.intent,
      topic: comment.topic,
      confidence: comment.confidence,
      productReference: comment.productReference,
      priorityLevel: comment.priorityLevel,
      finalScore: comment.finalScore,
      canCreateOrder: comment.canCreateOrder,
      canSuggestOrder: comment.canSuggestOrder,
      canCreateDraftOrder: comment.canCreateDraftOrder,
      isPotentialBuyer: comment.isPotentialBuyer,
      matchedReasons: comment.matchedReasons,
      // ponytail: gửi mã đã match cho Mobile — tạo nhanh (đường A) truyền lại làm override
      // để đơn tạo ra khớp đúng cái seller nhìn thấy, không để Backend đoán lại lần 2.
      matchedProductCode: comment.matchedProductCode,
      id: comment.id,
      dbId: comment.id,
    },
    createdAt,
  };

  sendRoomSse(room, shopId, "COMMENT", realtimePayload);

  let queueItem: Awaited<ReturnType<typeof upsertBuyingIntentQueueFromComment>> | null = null;
  try {
    queueItem = await upsertBuyingIntentQueueFromComment(comment);
    if (queueItem) sendRoomSse(room, shopId, "BUYING_INTENT_UPDATED", { item: queueItem });
  } catch (e: any) {
    // ponytail: queue is secondary; never drop the live comment because queue upsert failed.
    logger.warn({ err: e?.message, commentId: comment.id }, "[TIKTOK] buying intent queue failed");
  }

  const recommendationScore = Number(comment.finalScore ?? comment.confidence ?? 0);
  const isBuyWithPreset =
    comment.intent === "buy" && comment.canCreateOrder && Boolean(comment.matchedProductCode);

  // ── Tầng 1 (auto): điểm rất cao → tự tạo đơn nháp, seller chỉ review ──
  let autoCreated = false;
  if (
    AUTO_DRAFT_ORDER_ENABLED &&
    isBuyWithPreset &&
    comment.canCreateDraftOrder &&
    recommendationScore >= AUTO_DRAFT_MIN_SCORE
  ) {
    try {
      const ownerUserId = room.userId || (await findShopOwnerUserId(shopId));
      if (ownerUserId) {
        // ponytail: truyền matchedProductCode làm override — dùng đúng preset đã match lúc
        // phân loại, không fuzzy match lại lần 2. Khách đã có draft trong phiên → tự ghép đơn.
        const orderResult = await createOrderFromComment({
          shopId,
          userId: ownerUserId,
          comment: { ...commentPayload, id: comment.id, dbId: comment.id },
          liveSessionId: sessionId,
          note: "Tạo tự động từ comment live",
          productCode: comment.matchedProductCode,
        });
        autoCreated = true;

        // Khách đã có đơn → queue item chuyển "handled" để tab Cần xử lý không hỏi lại.
        if (queueItem) {
          try {
            const handledItem = await updateBuyingIntentQueueStatus({
              shopId,
              itemId: queueItem.id,
              status: "handled",
            });
            sendRoomSse(room, shopId, "BUYING_INTENT_UPDATED", { item: handledItem });
          } catch (e: any) {
            logger.warn({ err: e?.message }, "[TIKTOK] auto order: queue handled update failed");
          }
        }

        sendRoomSse(room, shopId, "ORDER_AUTO_CREATED", {
          shopId,
          liveSessionId: sessionId,
          commentId: comment.id,
          externalCommentId,
          tiktokUsername: comment.tiktokUsername,
          displayName: comment.displayName,
          orderId: orderResult.orderId,
          orderCode: orderResult.orderCode,
          merged: Boolean(orderResult.merged),
          confidence: recommendationScore,
          commentText: comment.commentText,
          createdAt: nowIso(),
        });
        logger.info(
          { username: room.username, orderCode: orderResult.orderCode, score: recommendationScore },
          "[TIKTOK] auto-created draft order from comment",
        );
      }
    } catch (e: any) {
      // ponytail: auto fail (hết quota đơn, preset vừa bị xoá...) → không chặn flow,
      // rơi xuống ORDER_RECOMMENDED để seller vẫn tạo tay được như cũ.
      logger.warn(
        { err: e?.message, commentId: comment.id },
        "[TIKTOK] auto draft order failed — falling back to recommendation",
      );
    }
  }

  // ── Tầng 2 (gợi ý): 85–89, auto tắt, hoặc auto fail → seller bấm tay như cũ ──
  if (!autoCreated && isBuyWithPreset && recommendationScore >= RECOMMEND_MIN_SCORE) {
    const matchedPreset = await matchPresetByComment(shopId, comment.commentText || commentText);
    if (matchedPreset) {
      sendRoomSse(room, shopId, "ORDER_RECOMMENDED", {
        shopId: shopId,
        liveSessionId: sessionId,
        commentId: comment.id,
        tiktokUsername: comment.tiktokUsername,
        displayName: comment.displayName,
        matchedPreset: {
          code: matchedPreset.code,
          name: matchedPreset.name,
          color: matchedPreset.color,
          price: matchedPreset.price,
        },
        confidence: recommendationScore,
        commentText: comment.commentText,
        createdAt,
      });
    }
  }

  await enqueueLiveEvent("comment-saved", {
    shopId: shopId,
    liveSessionId: sessionId,
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
  room.resolvedShopId = result.shopId;
  room.cachedSessionId = session.id;

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

  sendRoomSse(room, result.shopId, "LIVE_CONNECTED", payload);
  await enqueueLiveEvent("collector-live-connected", payload);

  logger.debug({ username: room.username, sessionId: session.id }, "[TIKTOK] LIVE_CONNECTED");
}

async function onDisconnected(room: RoomState) {
  if (room.isStopping) return;

  const endedAt = nowIso();
  const result = await ingestLiveEvent(room, "LIVE_DISCONNECTED");
  if (!result) return;

  const userId = room.userId || await findShopOwnerUserId(result.shopId);
  if (!userId) return;

  const session = await endLiveSession({
    shopId: result.shopId,
    userId,
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

  sendRoomSse(room, result.shopId, "LIVE_DISCONNECTED", payload);
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

  const userId = room.userId || await findShopOwnerUserId(result.shopId);
  let session: any = null;

  if (userId) {
    session = await endLiveSession({
      shopId: result.shopId,
      userId,
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

  sendRoomSse(room, result.shopId, "LIVE_ERROR", payload);
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

  const userId = room.userId || await findShopOwnerUserId(result.shopId);
  let session: any = null;

  if (userId) {
    session = await endLiveSession({
      shopId: result.shopId,
      userId,
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
    sendRoomSse(room, result.shopId, "COLLECTOR_STOPPED", payload);
  }
  await enqueueLiveEvent("collector-stopped", payload);
}

async function onViewerCount(room: RoomState, viewersCount: number) {
  const shopId = await resolveRoomShopId(room);
  if (!shopId) return;

  sendRoomSse(room, shopId, "VIEWER_COUNT_UPDATE", {
    shopId,
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

  const shopId = await resolveRoomShopId(room);
  if (!shopId) return;

  sendRoomSse(room, shopId, "USER_JOINED", {
    shopId,
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
  if (room.hasEmittedConnected) {
    // ponytail: reconnect thành công giữa chừng — reset cửa sổ retry, báo Mobile
    // "đã nối lại" thay vì chạy lại onConnected (session vẫn là session cũ).
    if (room.reconnectWindowStartedAt != null) {
      room.reconnectWindowStartedAt = null;
      room.reconnectAttempts = 0;
      room.roomId = roomId;
      room.isRunning = true;
      room.isConnecting = false;
      logger.info({ username: room.username }, "[TIKTOK] reconnected to live");
      emitReconnected(room);
    }
    return;
  }
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

// ponytail: hết cửa sổ grace hoặc lỗi vĩnh viễn → end session thật sự.
function failRoom(room: RoomState, message: string) {
  const key = roomKey(room.username, room.shopId, room.userId);
  room.isRunning = false;
  room.isConnecting = false;
  onError(room, message)
    .catch((e) => logger.error({ username: room.username, err: e?.message }, "[TIKTOK] onError failed"))
    .finally(() => rooms.delete(key));
}

// ponytail: reconnect-with-grace — retry với backoff + jitter trong RECONNECT_GRACE_WINDOW_MS.
// Mọi lần connect thất bại đều quay lại đây (kể cả connectRoom throw), không còn "bắn 1 phát rồi bỏ".
function scheduleReconnect(room: RoomState, code: number, reason: string) {
  const key = roomKey(room.username, room.shopId, room.userId);
  if (room.isStopping || !rooms.has(key)) return;

  const now = Date.now();
  if (room.reconnectWindowStartedAt == null) {
    room.reconnectWindowStartedAt = now;
    room.reconnectAttempts = 0;
  }

  if (now - room.reconnectWindowStartedAt >= RECONNECT_GRACE_WINDOW_MS) {
    logger.warn(
      { username: room.username, attempts: room.reconnectAttempts, code },
      "[TIKTOK] reconnect grace window exhausted",
    );
    failRoom(room, reason || `Mất kết nối TikTok Live (code ${code}), đã thử nối lại ${room.reconnectAttempts} lần.`);
    return;
  }

  room.isConnecting = true;
  room.isRunning = false;

  const attempt = room.reconnectAttempts;
  const base = RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)];
  const minDelay = code === ClientCloseCode.TOO_MANY_CONNECTIONS ? RATE_LIMIT_MIN_DELAY_MS : 0;
  const delay = Math.max(base, minDelay) + Math.floor(Math.random() * 1000);
  room.reconnectAttempts += 1;

  logger.info(
    { username: room.username, attempt: attempt + 1, delay, code, reason },
    "[TIKTOK] scheduling reconnect",
  );
  emitReconnecting(room, { attempt: attempt + 1, code, reason, nextRetryMs: delay });

  room.reconnectTimer = setTimeout(() => {
    room.reconnectTimer = null;
    if (room.isStopping || !rooms.has(key)) return;
    connectRoom(room).catch((e) => {
      logger.error({ username: room.username, err: e?.message }, "[TIKTOK] reconnect attempt failed");
      scheduleReconnect(room, code, e?.message || reason);
    });
  }, delay);
}

async function handleEulerClose(room: RoomState, code: number, reason: string) {
  logger.debug({ username: room.username, code, reason }, "[TIKTOK] websocket closed");
  room.connection = null;

  if (room.isStopping) return;

  const key = roomKey(room.username, room.shopId, room.userId);

  // Chưa từng connect được + NOT_LIVE → streamer chưa bật live. Trước đây throw ở đây rồi
  // trông cậy connectRoom(room).catch() bên startTikTokCollector bắt lại để bắn LIVE_ERROR —
  // nhưng connectRoom() đã resolve ngay sau khi đăng ký listener (không await sự kiện "close"),
  // nên throw async này chỉ rơi vào catch nội bộ của addEventListener("close", ...) (chỉ log,
  // không bắn SSE) → Mobile kẹt mãi ở "Đang lấy comment...". Gọi onError() trực tiếp tại đây để
  // luôn bắn LIVE_ERROR bất kể ai đang lắng nghe promise này.
  if (!room.hasEmittedConnected && code === ClientCloseCode.NOT_LIVE) {
    room.isRunning = false;
    room.isConnecting = false;
    await onError(room, "TikTok chưa bật live. Vui lòng kiểm tra lại phiên live.");
    rooms.delete(key);
    return;
  }

  // Live thật sự kết thúc: STREAM_END, hoặc NOT_LIVE khi đã từng connect
  // (kể cả khi đang trong lượt reconnect — nối lại mà "not live" nghĩa là live đã tắt).
  if (code === ClientCloseCode.STREAM_END || code === ClientCloseCode.NOT_LIVE) {
    room.isRunning = false;
    room.isConnecting = false;
    await onDisconnected(room);
    rooms.delete(key);
    return;
  }

  // Lỗi vĩnh viễn (sai key/quyền) — retry vô ích, end ngay.
  if (FATAL_CLOSE_CODES.includes(code)) {
    room.isRunning = false;
    room.isConnecting = false;
    await onError(room, reason || `Euler closed with code ${code}`);
    rooms.delete(key);
    return;
  }

  // ponytail: mọi mã còn lại — network blip (1006), timeout, rate limit, hết 8h lifetime,
  // lỗi server Euler... — đều là transient: giữ session sống, retry trong grace window.
  scheduleReconnect(room, code, reason);
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
      rooms.delete(roomKey(room.username, room.shopId, room.userId));
      logger.error({ username: room.username, err: room.lastError }, "[TIKTOK] websocket close handler failed");
    });
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function startTikTokCollector({
  username,
  shopId,
  userId,
  liveSessionId,
}: {
  username: string;
  shopId?: string | null;
  userId?: string | null;
  liveSessionId?: string | null;
}) {
  const normalized = username.replace(/^@/, "").trim().toLowerCase();
  const key = roomKey(normalized, shopId, userId);

  if (rooms.has(key)) {
    const existing = rooms.get(key)!;
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
    userId: userId || null,
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
    reconnectAttempts: 0,
    reconnectWindowStartedAt: null,
    resolvedShopId: null,
    cachedSessionId: null,
  };

  rooms.set(key, room);

  logger.debug({ username: normalized, shopId }, "[TIKTOK] startTikTokCollector");
  connectRoom(room).catch((err) => {
    const message = err?.message || String(err);
    logger.error({ username: normalized, err: message }, "[TIKTOK] connectRoom failed");
    room.isConnecting = false;
    room.isRunning = false;
    room.lastError = message;
    rooms.delete(key);

    if (room.shopId) {
      const isOffline =
        message.toLowerCase().includes("online") ||
        message.toLowerCase().includes("offline");
      const friendlyMessage = isOffline ? "TikTok chưa bật live" : message;
      const createdAt = nowIso();
      sendRoomSse(room, room.shopId, "LIVE_ERROR", {
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
  shopId,
  userId,
  silent,
}: {
  username: string;
  shopId?: string | null;
  userId?: string | null;
  silent?: boolean;
}) {
  const normalized = username.replace(/^@/, "").trim().toLowerCase();
  const key = roomKey(normalized, shopId, userId);
  const room = rooms.get(key);

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

  rooms.delete(key);

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
    reconnectAttempts: r.reconnectAttempts,
    isReconnecting: r.reconnectWindowStartedAt != null,
    commentCount: r.commentCount,
    startedAt: r.startedAt,
    lastCommentAt: r.lastCommentAt,
    lastError: r.lastError,
  }));
}
