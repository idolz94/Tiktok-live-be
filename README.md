# Lumi Backend

Backend riêng cho client Next.js của Lumi.

Stack: **Node.js + Express + Neon Postgres + Drizzle ORM + Clerk Auth**

```txt
Client Next.js / React Native
  ↓
Lumi Backend API (Express)
  ↓
Neon Postgres (Drizzle ORM) + Redis / BullMQ
  ↓ SSE
Client Next.js / React Native
```

```txt
TikTok Collector
  ↓ x-internal-api-key
Backend /api/internal/*
  ↓
Neon Postgres + SSE broadcast
```

## 1. API

```txt
GET    /api/me/bootstrap

GET    /api/orders
POST   /api/orders/from-comment
PATCH  /api/orders/:orderId/deposit-status
PATCH  /api/orders/:orderId/status
DELETE /api/orders/:orderId

GET    /api/live-sessions/history?limit=100
POST   /api/live-sessions/started
POST   /api/live-sessions/ended

GET    /api/licenses/current
POST   /api/licenses/refresh

POST   /api/payments/checkout
POST   /api/payments/manual-confirm

GET    /api/live-stream/events   (SSE)
POST   /api/live-stream/start
POST   /api/live-stream/stop

POST   /api/internal/live-comments/ingest
POST   /api/internal/live-events

GET    /health
```

## 2. Cài đặt

```bash
cd lumi-backend
npm install
cp .env.example .env
```

Điền `.env`:

```env
PORT=3001
CLIENT_ORIGIN=http://localhost:3000
DATABASE_URL=postgresql://user:pass@host.neon.tech/lumi?sslmode=require
CLERK_SECRET_KEY=sk_...
CLERK_PUBLISHABLE_KEY=pk_...
NODE_INTERNAL_API_KEY=change_me
COLLECTOR_BASE_URL=http://localhost:8765
COLLECTOR_CONTROL_API_KEY=change_me
MOBILE_APP_KEY=change_me
```

Chạy migration (Neon SQL Editor hoặc `drizzle-kit push`):

```bash
npx drizzle-kit push
```

Chạy server:

```bash
npm run dev
```

Test nhanh:

```bash
curl http://localhost:3001/health
```

## 3. Redis / Worker

Mặc định Redis tắt để bạn chạy API trước cho dễ.

Bật Redis:

```bash
docker compose up -d redis
```

`.env`:

```env
ENABLE_REDIS=true
REDIS_URL=redis://localhost:6379
```

Chạy worker:

```bash
npm run dev:worker
```

Worker hiện có queue:

- `live-events`: comment saved, live started, live ended.
- `payment-events`: dành cho webhook payment sau này.

## 4. Auth

Backend dùng **Clerk** để verify JWT. Client gửi:

```txt
Authorization: Bearer <clerk-access-token>
```

Hoặc cookie `lumi_access_token` (Next.js web). React Native gửi thêm `x-app-key` header.

Clerk handle hoàn toàn register/login — backend không có `/api/auth/*` nữa.

## 5. Bootstrap

Client gọi `GET /api/me/bootstrap` sau khi Clerk login, backend trả:

```json
{
  "userId": "user_2abc...",
  "shop": {},
  "license": {},
  "tiktokChannels": [],
  "canUseApp": true,
  "reason": null
}
```

Nếu shop chưa tồn tại, backend tự tạo shop + trial license.

## 6. Payment

Hiện payment đang để `manual` để không phụ thuộc cổng thanh toán.

```http
POST /api/payments/checkout
Authorization: Bearer <token>
Content-Type: application/json

{ "planCode": "basic", "months": 1, "amount": 199000 }
```

```http
POST /api/payments/manual-confirm
Authorization: Bearer <token>
Content-Type: application/json

{ "paymentId": "uuid" }
```

## 7. Ghi chú quan trọng

- Client Next.js chỉ cần `NEXT_PUBLIC_API_URL`.
- Không expose `DATABASE_URL`, `CLERK_SECRET_KEY`, `NODE_INTERNAL_API_KEY` ra client.
- Nếu deploy backend domain khác, cập nhật `CLIENT_ORIGIN` để CORS cho phép domain client.
- Response chuẩn: `{ ok: true, data }` hoặc `{ ok: false, message }`.
