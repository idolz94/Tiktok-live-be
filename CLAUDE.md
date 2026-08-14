# CLAUDE.md

# Lumi Backend Node.js

## Vai trò repo

Repo này là Backend Node.js Express của Lumi.

Backend là **source of truth** của toàn bộ business logic.

Backend chịu trách nhiệm:

* Xác thực user bằng JWT.
* Map user sang `users` trong Neon.
* Bootstrap user / license / shops / channels / settings.
* Quản lý user license.
* Quản lý shop.
* Quản lý kênh live của shop: TikTok hiện tại, Facebook sau này.
* Quản lý shop settings.
* Quản lý shipping providers.
* Quản lý live sessions.
* Quản lý live comments.
* Nhận internal comment/event từ collector.
* Lưu comment vào Neon bằng Drizzle.
* Broadcast realtime SSE/WebSocket-ready event.
* Tạo customer từ comment.
* Tạo order từ comment.
* Quản lý customers.
* Quản lý customer addresses.
* Quản lý orders.
* Quản lý products / product variants.
* Quản lý license / payment sau này.

Backend không được để client gọi database trực tiếp.

Collector không được ghi database trực tiếp.

---

## Kiến trúc hệ thống

```txt
Next.js Client / React Native App
        ↓ JWT token + Backend API
Backend Node.js Express
        ↓ Drizzle ORM
Neon Postgres
```

Realtime/comment flow:

```txt
TikTok Collector
        ↓ Internal API
Backend Node.js
        ↓ Drizzle ORM
Neon Postgres
        ↓ SSE/WebSocket realtime
Next.js Client / React Native App
```

Collector chỉ gửi comment/event sang Backend.

Backend lưu database và broadcast realtime.

---

## Stack hiện tại

Backend:

* Node.js
* Express
* TypeScript
* JWT Auth (access token + refresh token)
* Neon Postgres
* Drizzle ORM
* Zod validation
* SSE realtime
* Collector internal API

Database:

* Neon Postgres
* Drizzle ORM
* Drizzle migrations

Không dùng Supabase trong backend mới.

---

## Quy tắc bắt buộc

* Backend là source of truth.
* Client không gọi Neon trực tiếp.
* Client không gọi collector trực tiếp.
* Collector không gọi Neon trực tiếp.
* Collector không dùng Drizzle.
* Collector không verify Clerk.
* Collector không check license.
* Collector không tạo customer.
* Collector không tạo order.
* Collector chỉ gửi comment/event sang Backend.
* Backend lưu DB và broadcast realtime.
* Internal API phải check `x-internal-api-key`.
* Route validate body/query bằng Zod.
* Route không chứa business logic quá lớn.
* Business logic đặt trong service layer.
* Drizzle query đặt trong service/repository layer.
* Response chuẩn: `{ ok: true, data }` hoặc `{ ok: false, message }`.
* Không expose secret ra client.
* Không expose provider tokens ra client.
* Với thay đổi route/contract, kiểm tra impact trước khi sửa để tránh đổi response shape âm thầm.
* Khi task đụng auth/db/business logic, ưu tiên `backend-feature` hoặc `cross-repo-change` thay vì tự suy đoán flow.

Không expose các biến sau:

```txt
DATABASE_URL
JWT_SECRET
JWT_REFRESH_SECRET
NODE_INTERNAL_API_KEY
COLLECTOR_CONTROL_API_KEY
MOBILE_APP_KEY
GHN_TOKEN
VTP_TOKEN
GHTK_TOKEN
```

---

## Business model

Nguyên tắc database lâu dài:

```txt
1 user có 1 license.
1 user có nhiều shop.
1 shop có nhiều live channels.
1 live channel có platform: TikTok hiện tại, Facebook sau này.
1 shop có nhiều live sessions.
1 live session có nhiều comments.
1 live session có nhiều orders.
1 comment có thể tạo customer.
1 comment có thể tạo order.
1 customer có nhiều orders.
1 customer có nhiều shipping addresses.
1 order có nhiều order items.
1 shop có nhiều shipping providers.
1 shop có settings mặc định cho order/shipping/product.
```

Các bảng core:

```txt
users
user_licenses

shops
shop_channels
shop_settings

shipping_providers
shop_shipping_providers

live_sessions
live_comments

customers
customer_addresses

products
product_variants

orders
order_items
```

---

## Database / Drizzle rules

ORM: Drizzle.

Database: Neon Postgres.

Lý do chọn Drizzle:

* SQL-first.
* Query phức tạp dễ kiểm soát.
* Không có Prisma engine binary.
* Deploy nhẹ hơn trên Render/Railway.
* Migration là plain SQL, dễ audit và rollback.
* Phù hợp business có live sessions, comments, orders, customers.

Quy tắc:

* Schema đặt trong `src/db/schema`.
* DB client đặt trong `src/lib/db.ts` hoặc `src/db/index.ts`.
* Migration đặt trong `src/db/migrations`.
* Không viết query lớn trực tiếp trong route.
* Route gọi service.
* Service gọi Drizzle.
* Mọi bảng business nên có `shop_id`.
* Tiền VND lưu bằng integer, không dùng float.
* `order_items` phải lưu snapshot product info: name, code, price, color, size.
* `live_comments` phải chống duplicate.
* Không dùng Supabase client/service role trong code mới.

Index quan trọng:

```txt
users.clerk_user_id unique

shops.owner_user_id
shop_channels.shop_id
shop_channels.shop_id + platform + username unique

live_sessions.shop_id + created_at
live_sessions.channel_id + created_at

live_comments.shop_id + created_at
live_comments.live_session_id + created_at
live_comments.live_session_id + external_comment_id unique

customers.shop_id + platform + username unique
orders.shop_id + created_at
orders.live_session_id + created_at
orders.customer_id + created_at
order_items.order_id
```

---

## Auth rules

Auth provider: JWT (access token + refresh token tự build).

Backend xác thực bằng JWT do chính backend cấp.

Quy tắc:

* Không dùng Clerk.
* Không dùng Supabase Auth.
* Không dùng cookie `lumi_access_token` kiểu cũ.
* Middleware auth verify JWT (verify signature, expiry).
* Sau khi verify JWT, backend resolve `userId` từ payload.
* Protected route phải có `req.user` hoặc context tương đương.
* Protected shop route phải check user có quyền với shop.
* Protected app action phải check license còn active.
* Access token ngắn hạn (15–60 phút).
* Refresh token dài hạn, lưu trong DB hoặc Redis để có thể revoke.
* Không đưa refresh token ra response body nếu dùng httpOnly cookie.
* Không log token dưới bất kỳ hình thức nào.

User mới:

```txt
1. Client gọi POST /api/auth/register.
2. Backend tạo `users`.
3. Backend tạo `user_licenses` mặc định 1 tháng.
4. Backend tạo shop mặc định.
5. Backend tạo shop_settings mặc định.
6. Backend trả access token + refresh token.
```

License mặc định:

```txt
plan = trial
status = active
starts_at = now
expires_at = now + 1 month
```

---

## Auth: Next.js vs React Native

| Client          | Auth method         | Ghi chú                                                                                    |
| --------------- | ------------------- | ------------------------------------------------------------------------------------------ |
| Next.js browser | JWT access token    | Request wrapper gửi `Authorization: Bearer <access_token>` |
| React Native    | JWT access token    | Gửi `Authorization: Bearer <access_token>`                                                  |
| Internal collector | Internal API key    | Gửi `x-internal-api-key`                                                                   |

React Native có thể gửi thêm:

```txt
x-app-key: MOBILE_APP_KEY
```

để backend phân biệt mobile app nếu cần.

Nhưng quyền chính vẫn phải dựa trên JWT token đã verify.

---

## CORS

`CLIENT_ORIGIN` hỗ trợ nhiều domain phân cách bằng dấu phẩy:

```env
CLIENT_ORIGIN=http://localhost:3000,https://lumilive.vn,https://www.lumilive.vn
```

Production không dùng `CLIENT_ORIGIN=*` nếu không cần.

React Native thường không có browser Origin header, nên backend không được phụ thuộc hoàn toàn vào Origin để xác thực mobile.

---

## Env

### Local

```env
PORT=3001
NODE_ENV=development

DATABASE_URL=postgresql://...
JWT_SECRET=dev_secret_change_me
JWT_REFRESH_SECRET=dev_refresh_secret_change_me
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=30d

CLIENT_ORIGIN=http://localhost:3000
MOBILE_APP_KEY=dev_mobile_key

NODE_INTERNAL_API_KEY=change_me
COLLECTOR_BASE_URL=http://localhost:8765
COLLECTOR_CONTROL_API_KEY=change_me
```

### Production

```env
PORT=3001
NODE_ENV=production

DATABASE_URL=postgresql://...
JWT_SECRET=your_strong_jwt_secret
JWT_REFRESH_SECRET=your_strong_refresh_secret
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=30d

CLIENT_ORIGIN=https://lumilive.vn,https://www.lumilive.vn
MOBILE_APP_KEY=your_strong_mobile_app_key

NODE_INTERNAL_API_KEY=your_strong_internal_key
COLLECTOR_BASE_URL=https://collector-domain.com
COLLECTOR_CONTROL_API_KEY=your_strong_collector_key
```

Optional sau này:

```env
REDIS_URL=
PAYMENT_WEBHOOK_SECRET=
```

---

## API response format

Success:

```json
{
  "ok": true,
  "data": {}
}
```

Error:

```json
{
  "ok": false,
  "message": "Error message"
}
```

Không trả raw error stack cho client production.

---

## Nhóm API chính

### Health

```txt
GET /api/health
```

---

### Me / Bootstrap

```txt
GET /api/me/bootstrap
```

Bootstrap trả về:

* user
* license
* canUseApp
* shops
* currentShop
* shopChannels
* defaultChannel
* shopSettings
* limits nếu cần

Không dùng bootstrap thay cho mọi API màn hình.

---

### Shops

```txt
GET    /api/shops
POST   /api/shops
GET    /api/shops/:shopId
PATCH  /api/shops/:shopId
DELETE /api/shops/:shopId
```

---

### Shop channels

```txt
GET    /api/shops/:shopId/channels
POST   /api/shops/:shopId/channels
PATCH  /api/shops/:shopId/channels/:channelId
DELETE /api/shops/:shopId/channels/:channelId
```

Channel platform:

```txt
tiktok
facebook
```

---

### Shop settings

```txt
GET   /api/shops/:shopId/settings
PATCH /api/shops/:shopId/settings
```

Settings gồm:

* default shipping fee
* default deposit type
* default deposit amount
* default deposit percent
* same price enabled
* same price amount
* default shipping dimensions
* auto create customer from comment
* auto detect order comment

---

### Shipping providers

```txt
GET    /api/shipping/providers
GET    /api/shops/:shopId/shipping-providers
POST   /api/shops/:shopId/shipping-providers
PATCH  /api/shops/:shopId/shipping-providers/:providerId
DELETE /api/shops/:shopId/shipping-providers/:providerId
```

Provider tokens/config không được trả raw về client.

---

### Live stream

```txt
GET  /api/live-stream/events
POST /api/live-stream/start
POST /api/live-stream/stop
```

---

### Live sessions

```txt
GET /api/live-sessions
GET /api/live-sessions/history
GET /api/live-sessions/:sessionId
GET /api/live-sessions/:sessionId/comments
GET /api/live-sessions/:sessionId/orders
```

Một `live_session` đã ended chính là lịch sử live.

---

### Live comments

```txt
GET /api/live-sessions/:sessionId/comments
```

Internal ingest:

```txt
POST /api/internal/live-comments/ingest
```

---

### Customers

```txt
GET    /api/customers
POST   /api/customers
GET    /api/customers/:customerId
PATCH  /api/customers/:customerId
DELETE /api/customers/:customerId
```

---

### Customer addresses

```txt
GET    /api/customers/:customerId/addresses
POST   /api/customers/:customerId/addresses
PATCH  /api/customers/:customerId/addresses/:addressId
DELETE /api/customers/:customerId/addresses/:addressId
```

---

### Products

```txt
GET    /api/products
POST   /api/products
GET    /api/products/:productId
PATCH  /api/products/:productId
DELETE /api/products/:productId
```

---

### Product variants

```txt
GET    /api/products/:productId/variants
POST   /api/products/:productId/variants
PATCH  /api/products/:productId/variants/:variantId
DELETE /api/products/:productId/variants/:variantId
```

---

### Orders

```txt
GET    /api/orders
POST   /api/orders
POST   /api/orders/from-comment
POST   /api/orders/merge-drafts
GET    /api/orders/:orderId
PATCH  /api/orders/:orderId
DELETE /api/orders/:orderId
PATCH  /api/orders/:orderId/deposit-status
PATCH  /api/orders/:orderId/status
```

---

### License

```txt
GET  /api/licenses/current
POST /api/licenses/refresh
```

---

### Payments

```txt
GET  /api/payments
POST /api/payments/webhook
```

Payment chưa cần implement nếu chưa có flow thực tế.

Không tự tạo payment logic giả nếu user chưa yêu cầu.

---

## Internal APIs

### Comment ingest

```txt
POST /api/internal/live-comments/ingest
```

Headers:

```txt
x-internal-api-key: NODE_INTERNAL_API_KEY
```

Payload nên gồm:

```txt
shopId
liveSessionId
externalCommentId
platform
platformUsername
displayName
avatarUrl
commentText
rawCreatedAt
rawPayload
```

Backend xử lý:

```txt
1. Check x-internal-api-key.
2. Validate body bằng Zod.
3. Ensure shop/live session hợp lệ.
4. Save/upsert live comment.
5. Optionally create/update customer.
6. Analyze intent ở backend nếu có rule.
7. Update live_sessions.comment_count.
8. Broadcast SSE event COMMENT.
```

---

### Live events

```txt
POST /api/internal/live-events
```

Headers:

```txt
x-internal-api-key: NODE_INTERNAL_API_KEY
```

Events:

```txt
LIVE_CONNECTED
LIVE_DISCONNECTED
LIVE_ERROR
COLLECTOR_STOPPED
```

Backend xử lý:

```txt
LIVE_CONNECTED:
- Mark live session as live/running.
- Broadcast LIVE_CONNECTED.

LIVE_DISCONNECTED:
- End live session.
- Broadcast LIVE_DISCONNECTED.

LIVE_ERROR:
- If shouldStop=true, end live session as error.
- Broadcast LIVE_ERROR.

COLLECTOR_STOPPED:
- End live session.
- Broadcast COLLECTOR_STOPPED.
```

---

## Flow Start Live

Client gọi:

```txt
POST /api/live-stream/start
```

Backend xử lý:

```txt
1. Verify JWT.
2. Resolve current user.
3. Check user license.
4. Resolve shopId/currentShop.
5. Check user owns or can access shop.
6. Resolve channel hoặc username.
7. Create live_session.
8. Call collector /start.
9. Truyền { username, shopId, liveSessionId, platform }.
10. Return liveSession to client.
```

Collector `/start` payload:

```json
{
  "username": "tiktok_username",
  "shopId": "shop_id",
  "liveSessionId": "live_session_id",
  "platform": "tiktok"
}
```

---

## Flow Comment

Collector gửi:

```txt
POST /api/internal/live-comments/ingest
```

Backend xử lý:

```txt
1. Check x-internal-api-key.
2. Validate payload bằng Zod.
3. Resolve shop.
4. Resolve live session.
5. Deduplicate comment.
6. Save live comment.
7. Create/update customer nếu bật auto_create_customer_from_comment.
8. Analyze intent ở backend.
9. Update live_sessions.comment_count.
10. Broadcast SSE COMMENT.
```

---

## Flow Stop Live

Client gọi:

```txt
POST /api/live-stream/stop
```

Backend xử lý:

```txt
1. Verify JWT.
2. Resolve user/shop/liveSession.
3. Check permission.
4. Call collector /stop.
5. End live session.
6. Update ended_at, duration_seconds, status, end_reason.
7. Broadcast COLLECTOR_STOPPED or LIVE_DISCONNECTED nếu cần.
```

---

## Quy tắc live_sessions

Khi start:

```txt
status = starting hoặc live
started_at có giá trị
ended_at = null
duration_seconds = 0
comment_count = 0
order_count = 0
```

Khi connected:

```txt
status = live
```

Khi stop/disconnect:

```txt
status = ended hoặc error
ended_at có giá trị
duration_seconds > 0
end_reason có giá trị
```

End reasons:

```txt
manual_stop
live_disconnected
collector_error
client_closed
```

---

## Quy tắc live_comments

Comment phải lưu các field chính:

```txt
shop_id
live_session_id
customer_id
source_order_id
external_comment_id
platform
platform_username
display_name
avatar_url
comment_text
intent
priority_level
final_score
can_create_order
is_order_created
raw_payload
created_at
```

Chống duplicate bằng:

```txt
live_session_id + external_comment_id
```

Không chỉ dùng `shop_id + external_comment_id`, vì external id có thể trùng giữa các session hoặc source khác nhau.

---

## Logic intent comment

Phân tích intent ở Backend, không làm ở collector.

Các intent:

```txt
buy
ask_price
ask_stock
ask_shipping
ask_product
ask_how_to_buy
normal
spam
```

Priority levels:

```txt
high
medium
low
normal
```

Rule-first trước, AI sau.

---

## Customer rules

Một comment có thể tạo customer.

Backend nên tạo/update customer theo unique:

```txt
shop_id + platform + username
```

Customer có thể update:

```txt
display_name
phone
email
note
avatar_url
last_seen_at
```

Customer có nhiều địa chỉ trong `customer_addresses`.

Không tạo duplicate customer nếu cùng TikTok username trong cùng shop.

---

## Order rules

Một comment có thể tạo một order.

Một live session có nhiều orders.

Một customer có nhiều orders.

Khi tạo order từ comment:

```txt
1. Check comment thuộc shop.
2. Check comment chưa tạo order nếu business yêu cầu 1 comment = 1 order.
3. Ensure/create customer.
4. Create order.
5. Create order_items nếu có product data.
6. Snapshot customer info/address/product info vào order/order_items.
7. Mark live_comments.is_order_created = true.
8. Link live_comments.source_order_id = order.id.
9. Update live_sessions.order_count.
```

Order statuses:

```txt
draft
confirmed
packed
shipped
completed
cancelled
```

Deposit statuses:

```txt
unpaid
deposited
paid
```

Money fields should be integer VND:

```txt
subtotal_amount
shipping_fee
discount_amount
deposit_amount
total_amount
```

---

## Shop settings rules

`shop_settings` dùng cho default values khi tạo order.

Các field chính:

```txt
default_shipping_fee
default_deposit_type
default_deposit_amount
default_deposit_percent
same_price_enabled
same_price_amount
default_weight_gram
default_length_cm
default_width_cm
default_height_cm
auto_create_customer_from_comment
auto_detect_order_comment
```

Khi tạo order:

```txt
shipping_fee lấy từ shop_settings.default_shipping_fee nếu request không truyền.
deposit lấy từ shop_settings nếu request không truyền.
product price lấy từ same_price_amount nếu same_price_enabled=true.
shipping dimensions lấy từ product_variant hoặc shop_settings default.
```

---

## SSE rules

SSE endpoint:

```txt
GET /api/live-stream/events
```

Events cần broadcast:

```txt
PING
LIVE_CONNECTED
COMMENT
LIVE_ERROR
LIVE_DISCONNECTED
COLLECTOR_STOPPED
ORDER_CREATED
CUSTOMER_CREATED
```

Quy tắc:

* SSE chỉ gửi data của shop/user được phép xem.
* Không broadcast comment của shop này sang shop khác.
* Có heartbeat `PING`.
* Clean up connection khi client disconnect.
* Không tạo memory leak khi nhiều client mở SSE.
* Next.js browser có thể dùng SSE.
* React Native sau này nên chuẩn bị WebSocket nếu SSE không ổn định.

Lưu ý: native `EventSource` trên browser không gửi custom Authorization header. Nếu SSE cần auth cross-origin, cần một trong các hướng:

```txt
1. Same-site cookie/session có credentials.
2. Token ngắn hạn trên query do backend cấp.
3. Dùng fetch-stream thay EventSource.
4. Hoặc bổ sung WebSocket auth.
```

Không đưa Clerk secret hoặc long-lived token vào query string.

---

## Collector contract

Backend gọi collector:

```txt
POST COLLECTOR_BASE_URL/start
POST COLLECTOR_BASE_URL/stop
```

Headers:

```txt
x-collector-control-api-key: COLLECTOR_CONTROL_API_KEY
```

Collector chỉ nhận:

```txt
username
shopId
liveSessionId
platform
```

Collector không nhận Clerk user id.

Collector không check license.

Collector không tạo live session.

Collector không tạo order.

Collector không tạo customer.

---

## Commands

```bash
npm run dev
npm run typecheck
npm run build
npm run lint
```

Database commands:

```bash
npm run db:generate
npm run db:migrate
npm run db:studio
```

Nếu project không có script tương ứng, kiểm tra `package.json` trước khi chạy.

---

## Khi sửa code

Trước khi sửa:

1. Đọc route liên quan.
2. Đọc service liên quan.
3. Đọc schema Drizzle liên quan nếu sửa database.
4. Xác định có cần migration SQL không.
5. Không phá API path client đang dùng.
6. Không đổi response contract nếu không cần.
7. Với task hiểu flow lớn, dùng GitNexus trước khi đọc nhiều file.

Sau khi sửa:

1. Chạy `npm run typecheck` nếu có.
2. Chạy `npm run build`.
3. Nếu đổi schema, chạy `npm run db:generate`.
4. Review migration SQL trước khi migrate.
5. Ghi rõ file đã sửa.
6. Ghi rõ SQL/migration cần chạy nếu có.
7. Ghi rõ cách test bằng curl hoặc client.
8. Không commit trừ khi user yêu cầu.

---

# GitNexus Rules

Repo này dùng GitNexus để giảm context/token khi làm việc với Claude Code.

## Mục tiêu

* Giúp Claude Code hiểu cấu trúc repo trước khi đọc nhiều file.
* Giảm việc grep/read toàn bộ codebase.
* Ưu tiên tìm đúng file, đúng flow, đúng dependency trước khi sửa code.
* Tránh việc Claude sửa nhầm file vì thiếu context.
* Tránh nạp quá nhiều file vào context.

## Quy tắc bắt buộc

* Khi task yêu cầu hiểu flow lớn, phải dùng GitNexus trước khi đọc nhiều file.
* Không đọc toàn bộ repo nếu GitNexus đã có index.
* Không grep lan man qua nhiều thư mục nếu có thể hỏi GitNexus trước.
* Không mở quá nhiều file cùng lúc.
* Chỉ đọc những file GitNexus hoặc architect-agent xác định là liên quan.
* Trước khi sửa API route handler, dùng GitNexus `api_impact` nếu route đã được index.
* Trước refactor/rename symbol dùng nhiều nơi, dùng GitNexus `impact` hoặc `rename` dry-run.
* Sau khi refactor lớn, đổi nhiều function, đổi route, đổi service, phải re-index GitNexus.
* Sau khi git pull hoặc merge branch lớn, phải re-index GitNexus.
* Không để GitNexus tự ghi đè `CLAUDE.md`.
* Luôn chạy GitNexus với `--skip-agents-md` hoặc dùng `.gitnexusrc` có `skipContextFiles: true`.

## Commands

Index repo:

```bash
gitnexus analyze --skip-agents-md
```

Nếu repo dùng wrapper riêng:

```bash
node .gitnexus/run.cjs analyze --skip-agents-md
```

---

# Do Not

* Do not use Supabase in new code.
* Do not restore Supabase Auth.
* Do not use Clerk.
* Do not expose `DATABASE_URL`.
* Do not expose `JWT_SECRET` or `JWT_REFRESH_SECRET`.
* Do not expose `NODE_INTERNAL_API_KEY`.
* Do not expose `COLLECTOR_CONTROL_API_KEY`.
* Do not expose shipping provider tokens.
* Do not let client call Neon directly.
* Do not let client call collector directly.
* Do not let collector call Neon directly.
* Do not let collector create customers/orders.
* Do not put big business logic inside route handlers.
* Do not bypass Drizzle service layer.
* Do not commit unless the user explicitly asks.
