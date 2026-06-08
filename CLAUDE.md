# Lumi Live Backend Node.js

## Vai trò repo

Repo này là Backend Node.js Express của Lumi Live.

Backend chịu trách nhiệm:
- Auth API.
- Bootstrap user / shop / license.
- Live stream API.
- SSE realtime.
- Lưu live comments.
- Lưu live sessions.
- Tạo đơn từ comment.
- Quản lý orders.
- Quản lý license / payment.
- Nhận internal comment/event từ Python Collector.

## Kiến trúc

```txt
Client Next.js
        ↓
Backend Node.js Express
        ↓
Supabase / Redis
        ↓
SSE realtime
        ↓
Client Next.js
```

```txt
Python TikTok Collector
        ↓
Backend Node.js internal API
        ↓
Supabase + SSE
```

## Quy tắc bắt buộc

- Backend là source of truth.
- Client không gọi Supabase trực tiếp.
- Client không gọi Python trực tiếp.
- Python chỉ gửi comment/event sang Backend.
- Backend lưu DB và broadcast SSE.
- Internal API phải check `x-internal-api-key`.
- Không expose `SUPABASE_SERVICE_ROLE_KEY`.
- Không expose `NODE_INTERNAL_API_KEY`.
- Route validate body bằng zod.
- Supabase logic đặt trong service.
- Route không chứa business logic quá lớn.
- Response chuẩn: `{ ok: true, data }` hoặc `{ ok: false, message }`.

## Nhóm API chính

### Client APIs

```txt
/api/auth/*
/api/me/bootstrap
/api/live-stream/*
/api/orders/*
/api/live-sessions/*
/api/live-comments
/api/licenses/*
/api/payments/*
```

### Internal APIs

```txt
/api/internal/live-comments/ingest
/api/internal/live-events
```

## Flow Start Live

Client gọi:

```txt
POST /api/live-stream/start
```

Backend xử lý:
1. Check auth.
2. Lấy shopId từ user.
3. Gọi Python `/collectors/start`.
4. Truyền `{ username, shopId }`.
5. Trả response cho client.

## Flow Comment

Python gửi:

```txt
POST /api/internal/live-comments/ingest
```

Backend xử lý:
1. Check `x-internal-api-key`.
2. Resolve shop.
3. Ensure live session.
4. Gọi `saveLiveComment()`.
5. Lưu/upsert vào `live_comments`.
6. Update `live_sessions.comment_count`.
7. Broadcast SSE event `COMMENT`.

## Flow Stop Live

Client gọi:

```txt
POST /api/live-stream/stop
```

Backend xử lý:
1. Gọi Python `/collectors/stop`.
2. Gọi `endLiveSession()`.
3. Update:
   - `ended_at`
   - `duration_seconds`
   - `status`
   - `end_reason`
4. Broadcast SSE nếu cần.

## Python live events

Python gửi:

```txt
POST /api/internal/live-events
```

Các event cần xử lý:

```txt
LIVE_CONNECTED
LIVE_DISCONNECTED
LIVE_ERROR
COLLECTOR_STOPPED
```

Backend xử lý:

```txt
LIVE_CONNECTED:
- Ensure live session.

LIVE_DISCONNECTED:
- End live session.

LIVE_ERROR shouldStop=true:
- End live session.

COLLECTOR_STOPPED:
- End live session.
```

## Quy tắc live_sessions

Khi start:

```txt
status = running
started_at có giá trị
ended_at = null
duration_seconds = 0
```

Khi stop/disconnect:

```txt
status = ended hoặc error
ended_at có giá trị
duration_seconds > 0
end_reason có giá trị
```

## Quy tắc live_comments

Comment phải lưu các field chính:

```txt
shop_id
live_session_id
external_comment_id
tiktok_username
display_name
avatar_url
comment_text
intent
priority_level
final_score
can_create_order
is_order_created
```

Chống duplicate bằng:

```txt
shop_id + external_comment_id
```

## Logic intent comment

Phân tích intent ở Backend, không làm ở Python.

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

## Env

### Local

```env
PORT=3001
CLIENT_ORIGIN=http://localhost:3000
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
NODE_INTERNAL_API_KEY=change_me
PYTHON_COLLECTOR_BASE_URL=http://localhost:8765
COLLECTOR_CONTROL_API_KEY=change_me
```

### Production

```env
CLIENT_ORIGIN=https://lumilive.vn,https://www.lumilive.vn
PYTHON_COLLECTOR_BASE_URL=https://python-collector-domain.com
```

## Commands

```bash
npm run dev
npm run typecheck
npm run build
```

## Khi sửa code

Trước khi sửa:
1. Đọc route liên quan.
2. Đọc service liên quan.
3. Xác định có cần migration SQL không.
4. Không phá API path client đang dùng.

Sau khi sửa:
1. Chạy `npm run typecheck`.
2. Chạy `npm run build`.
3. Ghi rõ file đã sửa.
4. Ghi rõ SQL cần chạy nếu có.
5. Ghi rõ cách test bằng curl hoặc client.
