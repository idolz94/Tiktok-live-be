# Lumi Admin Dashboard — Outsource Specification

## Tổng quan

Xây dựng một **trang web admin nội bộ** để quản lý tài khoản người dùng và cập nhật license.

Hệ thống có hai loại người dùng:

| Loại | Client | Mô tả |
|---|---|---|
| **User thường** | Mobile app (React Native) | Người dùng Lumi bán hàng TikTok live |
| **Admin / Quản lý** | Dashboard (web) | Người vận hành Lumi, quản lý tài khoản, gia hạn license |

Dashboard **không phải** portal công khai — chỉ nội bộ Lumi truy cập.

---

## Kiến trúc tổng thể

```
Mobile App (React Native)          Admin Dashboard (web — repo mới)
        ↓                                    ↓
        ↓  JWT (Bearer token)                ↓  JWT (Bearer token)
        ↓                                    ↓
            Backend Node.js Express (repo này)
                        ↓ Drizzle ORM
                    Neon Postgres
```

---

## Phạm vi công việc

### Phần 1 — Backend (sửa trong repo này)

Thêm các endpoint admin còn thiếu vào `src/routes/admin.routes.ts` và service tương ứng.

### Phần 2 — Frontend Dashboard (repo mới)

Xây dựng web app riêng gọi vào backend API.

---

# PHẦN 1 — BACKEND

## Cấu trúc project

```
src/
├── config/
│   └── env.ts              # Đọc biến môi trường
├── db/
│   ├── schema/index.ts     # Drizzle schema — định nghĩa tables
│   └── migrations/         # Migration SQL files
├── lib/
│   ├── db.ts               # Drizzle client + DbOrTx type
│   ├── api-error.ts        # badRequest(), notFound(), forbidden(), unauthorized()
│   ├── response.ts         # ok(), mutateOk()
│   └── async-handler.ts    # Wrapper tránh try/catch lặp lại
├── middlewares/
│   ├── auth.ts             # requireAuth — verify JWT, set req.authUserId
│   └── internal-api-key.ts # requireInternalApiKey — check x-internal-api-key header
├── routes/
│   └── admin.routes.ts     # Admin routes — thêm endpoint mới vào đây
└── services/
    └── license.service.ts  # Business logic license
```

## Pattern chuẩn — thêm route mới

```ts
// routes/admin.routes.ts
import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler.js";
import { ok } from "../lib/response.js";
import { requireAuth } from "../middlewares/auth.js";
import { requireManager } from "../middlewares/require-role.js";

const router = Router();

router.get("/example", requireAuth, requireManager, asyncHandler(async (request, response) => {
  // logic...
  return ok(response, { data });
}));

export default router;
```

> Admin routes hiện tại dùng `requireAuth` + `requireManager` (JWT + role manager/admin), không dùng `x-internal-api-key`.

## Response format bắt buộc

```ts
// Thành công
return ok(response, { ... });           // { ok: true, data: { ... } }
return mutateOk(response, "message", { ... }); // { ok: true, message, data }

// Lỗi — throw, không return
throw badRequest("Dữ liệu không hợp lệ.");
throw notFound("Không tìm thấy.");
throw forbidden("Không có quyền.");
```

## Admin Auth

Tất cả admin routes (`/api/admin/*`) dùng `requireAuth` + `requireManager` — JWT Bearer token + role `manager` hoặc `admin`. Không dùng `x-internal-api-key`.

## Endpoints hiện có trong backend

### GET `/api/admin/licenses/:shopId`

Lấy license hiện tại của shop (kèm `planDefaults` để so sánh override).

```
GET /api/admin/licenses/:shopId
Authorization: Bearer <JWT manager/admin>
```

### POST `/api/admin/licenses/activate`

Kích hoạt hoặc gia hạn license.

```
POST /api/admin/licenses/activate
Authorization: Bearer <JWT manager/admin>
Content-Type: application/json

{
  "shopId": "uuid",
  "planCode": "basic",    // trial | basic | pro | vip
  "months": 1,            // 1–24
  "price": 199000,        // VND integer
  "paymentId": "PAY_001"  // optional
}
```

### PATCH `/api/admin/licenses/:shopId/tier`

Đổi tier (plan) mà không thay đổi ngày hết hạn.

```
PATCH /api/admin/licenses/:shopId/tier
Authorization: Bearer <JWT manager/admin>
Content-Type: application/json

{ "planCode": "pro" }
```

### Các endpoint license khác (manager+)

```
GET  /api/admin/licenses?query=&plan=&status=&expiringSoon=&sortBy=&page=&limit=
GET  /api/admin/licenses/:shopId/usage
GET  /api/admin/licenses/:shopId/history
PATCH /api/admin/licenses/:shopId/extend   { months: 1..60 }
PATCH /api/admin/licenses/:shopId/limits   { maxOrdersPerMonth?, maxLiveSessionsPerMonth?, maxMembers?, maxTiktokAccounts? }
```

Tất cả đều dùng `Authorization: Bearer <JWT manager/admin>` và ghi `admin_audit_logs`.

### POST `/api/admin/seed-plans`

Seed dữ liệu license plans. Chạy một lần khi setup.

---

## Endpoints cần thêm vào backend

### GET `/api/admin/users` — Tìm kiếm user

Outsource team thêm vào `src/routes/admin.routes.ts` và `src/services/` tương ứng.

**Request:**
```
GET /api/admin/users?username=keyword&page=1&limit=20
Authorization: Bearer <JWT manager/admin>
```

| Query param | Kiểu | Bắt buộc | Mô tả |
|---|---|---|---|
| `username` | string | ✅ | Tìm kiếm theo username (partial match, `ILIKE`) |
| `page` | number | | Trang, mặc định 1 |
| `limit` | number | | Số kết quả/trang, mặc định 20, tối đa 100 |

**Response:**
```json
{
  "ok": true,
  "data": {
    "users": [
      {
        "id": "uuid",
        "username": "nguyen_van_a",
        "email": "a@example.com",
        "phone": "0909000000",
        "fullName": "Nguyễn Văn A",
        "status": "active",
        "createdAt": "2024-01-01T00:00:00Z",
        "shop": {
          "id": "uuid",
          "name": "Shop của A",
          "licenseStatus": "active",
          "trialEndsAt": null
        },
        "license": {
          "planCode": "basic",
          "status": "active",
          "expiredAt": "2025-01-01T00:00:00Z"
        }
      }
    ],
    "total": 42,
    "page": 1,
    "limit": 20
  }
}
```

**Gợi ý implement (service):**

```ts
// src/services/admin.service.ts
import { ilike, eq, and } from "drizzle-orm";
import { db } from "../lib/db.js";
import { users, shops, shopLicenses, shopMembers } from "../db/schema/index.js";

export async function searchUsers({ username, page = 1, limit = 20 }: {
  username: string;
  page?: number;
  limit?: number;
}) {
  const offset = (page - 1) * limit;

  const rows = await db
    .select({
      id: users.id,
      username: users.username,
      email: users.email,
      phone: users.phone,
      fullName: users.fullName,
      status: users.status,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(ilike(users.username, `%${username}%`))
    .orderBy(users.createdAt)
    .limit(limit)
    .offset(offset);

  // Với mỗi user, query thêm shop + license nếu cần
  // ...

  return rows;
}
```

### GET `/api/admin/users/:userId` — Chi tiết user

```
GET /api/admin/users/:userId
Authorization: Bearer <JWT manager/admin>
```

**Response:**
```json
{
  "ok": true,
  "data": {
    "user": {
      "id": "uuid",
      "username": "nguyen_van_a",
      "email": "a@example.com",
      "phone": "0909000000",
      "fullName": "Nguyễn Văn A",
      "status": "active",
      "createdAt": "2024-01-01T00:00:00Z"
    },
    "shop": {
      "id": "uuid",
      "name": "Shop của A",
      "licenseStatus": "active",
      "trialEndsAt": null
    },
    "license": {
      "id": "uuid",
      "planCode": "basic",
      "status": "active",
      "startedAt": "2024-01-01T00:00:00Z",
      "expiredAt": "2025-01-01T00:00:00Z",
      "trialEndsAt": null,
      "maxOrdersPerMonth": 500,
      "maxMembers": 2,
      "maxTiktokAccounts": 1,
      "price": 199000,
      "currency": "VND",
      "paymentStatus": "paid"
    }
  }
}
```

---

## Quy tắc bắt buộc khi sửa backend

1. **Không sửa** các route/service hiện có nếu không liên quan task.
2. **Không thay đổi** response shape của các endpoint đang dùng bởi Mobile app.
3. **Validate input bằng Zod** tại route trước khi gọi service.
4. **Business logic đặt trong service**, không đặt trong route handler.
5. **Drizzle query đặt trong service**, không đặt trong route.
6. Sau khi thêm endpoint mới, chạy:
   ```bash
   npm run typecheck
   npm run build
   ```
7. Nếu đổi schema database, chạy:
   ```bash
   npm run db:generate
   ```
   Và gửi file migration SQL cho Lumi review trước khi migrate.
8. **Không commit** `.env` hoặc bất kỳ secret nào.

---

# PHẦN 2 — FRONTEND DASHBOARD

## Stack đề xuất

- Next.js 14+ (App Router)
- Tailwind CSS
- shadcn/ui hoặc Ant Design
- Axios + React Query
- TypeScript

## Auth flow

Admin dashboard đăng nhập bằng `POST /api/auth/login` với tài khoản có `role = manager` hoặc `admin`, nhận JWT và dùng `Authorization: Bearer <token>` cho mọi `/api/admin/*`.

## Màn hình cần xây dựng

### 1. Đăng nhập

- Form: username + password
- Gọi `POST /api/auth/login`
- Lưu `accessToken` (httpOnly cookie hoặc memory)
- Redirect về Dashboard sau khi đăng nhập thành công

### 2. Danh sách & tìm kiếm người dùng

**URL:** `/admin/users`

**Chức năng:**
- Ô tìm kiếm theo username (gõ → debounce 300ms → gọi API)
- Bảng kết quả:

| Cột | Dữ liệu |
|---|---|
| Username | `user.username` |
| Họ tên | `user.fullName` |
| Email / SĐT | `user.email` / `user.phone` |
| Tên shop | `shop.name` |
| Plan | `license.planCode` badge |
| Trạng thái | `license.status` badge |
| Hết hạn | `license.expiredAt` format ngày |
| Thao tác | Nút "Xem chi tiết" |

- Phân trang

### 3. Chi tiết người dùng

**URL:** `/admin/users/:userId`

**Hiển thị:**
- Thông tin user: username, họ tên, email, SĐT, ngày tạo
- Thông tin shop: tên shop, shopId
- License hiện tại:
  - Plan, trạng thái, ngày bắt đầu, ngày hết hạn
  - Giới hạn: đơn/tháng, members, TikTok accounts
  - Trạng thái thanh toán

**Actions:**
- Nút **"Gia hạn"** → mở modal form gia hạn
- Nút **"Đổi tier"** → mở modal chọn plan

### 4. Modal gia hạn license

```
Plan:        [Dropdown: Basic / Pro / VIP]
Số tháng:    [Input number: 1–24]
Số tiền:     [Input number, VND]
Mã thanh toán: [Input text, tuỳ chọn]

[Huỷ]  [Xác nhận gia hạn]
```

Gọi: `POST /api/admin/licenses/activate` (qua BFF proxy)

### 5. Modal đổi tier

```
Plan hiện tại: Basic
Chuyển sang:   [Dropdown: Trial / Basic / Pro / VIP]

Lưu ý: Đổi tier không thay đổi ngày hết hạn.

[Huỷ]  [Xác nhận]
```

Gọi: `PATCH /api/admin/licenses/:shopId/tier` (qua BFF proxy)

---

## Dữ liệu tham chiếu

### License plans

| `planCode` | Tên | Giá/tháng | Đơn/tháng | Members | TikTok |
|---|---|---|---|---|---|
| `trial` | Dùng thử | 0 | 200 | 1 | 1 |
| `basic` | Basic | 199.000 VND | 500 | 2 | 1 |
| `pro` | Pro | 183.000 VND | 1.500 | 5 | 2 |
| `vip` | VIP | 170.000 VND | Không giới hạn | 10 | 3 |

### License status badges

| `status` | Màu badge | Label |
|---|---|---|
| `trial` | Xanh dương | Dùng thử |
| `active` | Xanh lá | Đang hoạt động |
| `inactive` | Đỏ | Hết hạn |

---

## Checklist bàn giao

**Backend:**
- [ ] `GET /api/admin/users?username=` hoạt động, trả về user + shop + license
- [ ] `GET /api/admin/users/:userId` trả về chi tiết
- [ ] Typecheck và build pass sau khi thêm endpoint

**Frontend:**
- [ ] Đăng nhập / đăng xuất hoạt động
- [ ] Tìm kiếm user theo username
- [ ] Hiển thị danh sách với thông tin license
- [ ] Xem chi tiết user
- [ ] Gia hạn license (modal)
- [ ] Đổi tier license (modal)
- [ ] Admin gọi `/api/admin/*` bằng JWT `manager`/`admin` (không để lộ key ở browser bundle)
- [ ] Hiển thị lỗi rõ ràng khi API trả về `ok: false`
- [ ] Build production không có lỗi

---

## Bảo mật — Bắt buộc

| Quy tắc | |
|---|---|
| Admin JWT chỉ ở httpOnly cookie / memory | Không được xuất hiện trong JS bundle nếu không cần |
| Không commit `.env` | Thêm vào `.gitignore` |
| Không log token | Không `console.log` accessToken |
| Không sửa Mobile API contracts | Các endpoint mobile đang dùng không được thay đổi response shape |
| Không expose secret ra client | `DATABASE_URL`, `JWT_SECRET` không được dùng trong frontend |

---

## Liên hệ khi gặp vấn đề

- Cần thêm endpoint backend → liên hệ Lumi team trước khi tự thêm
- Cần đổi schema database → gửi migration SQL cho Lumi review trước khi chạy
- Cần secret/credentials → liên hệ Lumi team, không tự tạo
