# Lumi Backend

Backend riêng cho client Next.js của Lumi.

Luồng mới:

```txt
Client Next.js
  ↓ getRequest/postRequest trong src/lib/request.ts
Lumi Backend API
  ↓ service role key
Supabase Postgres/Auth
  ↓ optional
Redis / BullMQ Worker / Payment / License
```

## 1. API đúng với client đang call

Client hiện chỉ cần set:

```env
NEXT_PUBLIC_API_URL=http://localhost:3001/api
```

Backend đã có các endpoint:

```txt
POST   /api/auth/register
POST   /api/auth/login
POST   /api/auth/logout
GET    /api/me/bootstrap

GET    /api/orders
POST   /api/orders/from-comment
PATCH  /api/orders/:orderId/deposit-status
PATCH  /api/orders/:orderId/status
DELETE /api/orders/:orderId

GET    /api/live-sessions/history?limit=100
POST   /api/live-sessions/started
POST   /api/live-sessions/ended
POST   /api/live-comments
```

Có thêm module mở rộng:

```txt
GET    /api/licenses/current
POST   /api/licenses/refresh
POST   /api/payments/checkout
POST   /api/payments/manual-confirm
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
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_SUPABASE_SERVICE_ROLE_KEY
ENABLE_REDIS=false
```

Chạy migration trong Supabase SQL Editor:

```txt
supabase/migrations/001_initial_schema.sql
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

Client login/register nhận `accessToken`. `src/lib/request.ts` sẽ tự gửi:

```txt
Authorization: Bearer <accessToken>
```

Backend verify token bằng Supabase Auth, sau đó lấy `profiles`, `shop_members`, `shops`, `shop_licenses` bằng service role.

## 5. License

Khi register, backend tự tạo:

- `profiles`
- `shops`
- `shop_members`
- `shop_licenses` trial

Client gọi `GET /api/me/bootstrap`, backend trả:

```json
{
  "user": {},
  "profile": {},
  "shopMember": {},
  "shop": {},
  "license": {},
  "canUseApp": true,
  "reason": null
}
```

Nếu license hết hạn, các API nghiệp vụ trả `403` với message:

```txt
Shop đã hết hạn dùng thử hoặc chưa có license.
```

## 6. Payment

Hiện payment đang để `manual` để không phụ thuộc cổng thanh toán.

Tạo checkout:

```http
POST /api/payments/checkout
Authorization: Bearer <token>
Content-Type: application/json

{
  "planCode": "basic",
  "months": 1,
  "amount": 199000
}
```

Sau khi nhận tiền thủ công, gọi:

```http
POST /api/payments/manual-confirm
Authorization: Bearer <token>
Content-Type: application/json

{
  "paymentId": "uuid"
}
```

Endpoint này sẽ active license mới cho shop.

## 7. Ghi chú quan trọng

- Không đưa `SUPABASE_SERVICE_ROLE_KEY` vào client.
- Client Next.js chỉ cần `NEXT_PUBLIC_API_URL`.
- Nếu deploy backend domain khác, cập nhật `CLIENT_ORIGIN` để CORS cho phép domain client.
- Backend đang trả response dạng `{ ok: true, data }`, phù hợp với `request.ts` đã refactor vì file đó tự unwrap `data`.
