# Lumi Backend

Backend riêng cho client Next.js / React Native của Lumi.

Stack: **Node.js + Express + Neon Postgres + Drizzle ORM + JWT Auth**

```txt
Client Next.js / React Native
  ↓ JWT (Bearer token)
Lumi Backend API (Express)
  ↓ Drizzle ORM
Neon Postgres (+ SSE realtime)
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
POST   /api/auth/register
POST   /api/auth/login
POST   /api/auth/refresh
POST   /api/auth/logout
POST   /api/auth/reset-password

GET    /api/me/bootstrap
GET    /api/me/tiktok-channels
PATCH  /api/me/tiktok-channels/:channelId
PATCH  /api/me/profile
PATCH  /api/me/password

GET    /api/orders
POST   /api/orders/from-comment
POST   /api/orders/merge-drafts
PATCH  /api/orders/:orderId/deposit-status
PATCH  /api/orders/:orderId/status
DELETE /api/orders/:orderId

GET    /api/live-sessions/history?limit=100
GET    /api/live-sessions/:sessionId/comments
GET    /api/live-sessions/:sessionId/orders

GET    /api/licenses/current
POST   /api/licenses/refresh

POST   /api/admin/licenses/activate
GET    /api/admin/licenses
GET    /api/admin/licenses/:shopId
PATCH  /api/admin/licenses/:shopId/tier
PATCH  /api/admin/licenses/:shopId/extend
PATCH  /api/admin/licenses/:shopId/limits
GET    /api/admin/licenses/:shopId/usage
GET    /api/admin/licenses/:shopId/history

POST   /api/payments/checkout
POST   /api/payments/manual-confirm

GET    /api/live-stream/events   (SSE)
POST   /api/live-stream/start
POST   /api/live-stream/stop

POST   /api/internal/live-comments/ingest
POST   /api/internal/live-events

GET    /health
```

Mọi API shop nghiệp vụ (`orders`, `live-sessions`, `customers`, `tiktok-channels`, `shop-settings`, `shipments`...) yêu cầu `Authorization: Bearer <accessToken>` và sẽ trả `403` khi license hết hạn / inactive.

## 2. Cài đặt

```bash
cd Tiktok-live-be
npm install
cp .env.example .env
```

Điền `.env`:

```env
PORT=3001
NODE_ENV=development

DATABASE_URL=postgresql://user:pass@host.neon.tech/lumi?sslmode=require
JWT_SECRET=dev_secret_change_me
JWT_REFRESH_SECRET=dev_refresh_secret_change_me
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=30d

CLIENT_ORIGIN=http://localhost:3000
MOBILE_APP_KEY=dev_mobile_key

NODE_INTERNAL_API_KEY=change_me
COLLECTOR_BASE_URL=http://localhost:8765
COLLECTOR_CONTROL_API_KEY=change_me
TRIAL_DAYS=14
```

Chạy migration:

```bash
npm run db:generate
npm run db:migrate
# hoặc với drizzle-kit
npx drizzle-kit push
```

Chạy server:

```bash
npm run dev
npm run typecheck
npm run build
```

Test nhanh:

```bash
curl http://localhost:3001/health
curl http://localhost:3001/api/me/bootstrap -H "Authorization: Bearer <token>"
```

## 3. Redis / Worker

Mặc định Redis tắt để chạy API trước cho dễ.

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

Backend dùng **JWT tự build** (không dùng Clerk / Supabase Auth).

- `POST /api/auth/register` — tạo `users` + tự bootstrap `shops` + `shopMembers` + trial `shopLicenses` trong cùng transaction.
- `POST /api/auth/login` — verify password, kiểm tra `canUseApp` (license), trả `accessToken` + `refreshToken` (set httpOnly cookie).
- `POST /api/auth/refresh` — xoay refresh token.
- `POST /api/auth/logout` — thu hồi refresh token.

Client gửi:

```txt
Authorization: Bearer <access_token>
Cookie: lumi_access_token / lumi_refresh_token (Next.js web)
x-app-key: MOBILE_APP_KEY (React Native, tuỳ chọn)
```

Middleware `requireAuth` verify JWT và gắn `req.authUserId`. Mọi route shop phải đi qua `requireAuth`; route nghiệp vụ đi qua `requireUsableAccountContext` để chặn khi license hết hạn.

## 5. Bootstrap

Client gọi `GET /api/me/bootstrap` sau khi login. Backend trả:

```json
{
  "userId": "uuid",
  "profile": {},
  "shop": {},
  "shopMember": {},
  "license": {},
  "tiktokChannels": [],
  "canUseApp": true,
  "reason": null,
  "hasOrders": false,
  "hasHistory": false
}
```

Nếu user chưa có shop, backend tự tạo shop + membership + trial license trong một `db.transaction` (đảm bảo không tạo shop mà thiếu license).

## 6. License

- **Trial:** tạo tự động khi bootstrap, đọc giới hạn từ `licensePlans.code='trial'` (không hard-code). `trialDays` lấy từ `env.TRIAL_DAYS`.
- **Kích hoạt:** `POST /api/admin/licenses/activate` hoặc `activateLicenseFromPayment()` — copy `max*` từ `licensePlans` sang `shopLicenses`.
- **Gia hạn / đổi tier / đổi limits:** `PATCH /api/admin/licenses/:shopId/{extend,tier,limits}` — ghi `admin_audit_logs`.
- **Enforcement:**
  - `maxOrdersPerMonth` — chặn tại `order-core.service: assertOrderLimitNotExceeded`.
  - `maxLiveSessionsPerMonth` — chặn tại `live-sessions.service: startLiveSession / getOrCreateRunningLiveSession`.
  - `maxTiktokAccounts` — chặn tại `tiktok-channels.service: createTikTokChannel`.
  - `maxMembers` — chặn tại `account.service: addShopMember()` (mọi flow thêm thành viên phải đi qua hàm này).
  - Shop hết hạn / inactive — toàn bộ API nghiệp vụ dùng `requireUsableAccountContext` sẽ trả `403` với message `Shop đã hết hạn dùng thử hoặc chưa có license.` Các route `bootstrap`, `payment`, `license/current` được miễn chặn để user vẫn xem và gia hạn.
- **Cron hết hạn:** `expireOldLicenses()` đánh `shopLicenses.status='inactive'` khi quá `expiredAt`.

## 7. Payment

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

## 8. Ghi chú quan trọng

- Client Next.js chỉ cần `NEXT_PUBLIC_API_URL`.
- Không expose `DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `NODE_INTERNAL_API_KEY`, `COLLECTOR_CONTROL_API_KEY` ra client.
- Nếu deploy backend domain khác, cập nhật `CLIENT_ORIGIN` (hỗ trợ nhiều domain phân cách dấu phẩy).
- Response chuẩn: `{ ok: true, data }` hoặc `{ ok: false, message }`.
- Business logic đặt trong `src/services/*`, Drizzle query đặt trong service, route chỉ validate Zod và gọi service.
- Không để collector / client gọi Neon trực tiếp, không để collector tạo customer / order.
