# Order Merge Drafts API — Spec cho Mobile approve

Date: 2026-08-14
Status: ready for Mobile approval

## Business rule

- Chỉ ghép các order có `status = "draft"` và cùng một `customer.id`.
- User chọn một tập con draft orders; một trong số đó là đơn đích (`targetOrderId`), các đơn còn lại là nguồn.
- Items và comments của đơn nguồn được chuyển về đơn đích, sau đó đơn nguồn bị xoá.
- Ví dụ: 3 draft orders, merge 2 → còn 2 orders (đơn đích + đơn không được chọn).

## Endpoint

```txt
POST /api/orders/merge-drafts
Authorization: Bearer <access-token>
Content-Type: application/json
```

## Request body

```json
{
  "targetOrderId": "11111111-1111-4111-8111-111111111111",
  "sourceOrderIds": ["22222222-2222-4222-8222-222222222222"]
}
```

| Field | Type | Rule |
|---|---|---|
| `targetOrderId` | string (uuid) | Đơn được giữ lại; phải có `customerId`. |
| `sourceOrderIds` | string[] (uuid) | 1–50 đơn bị xoá; cùng customer với đơn đích. |

Backend tự loại duplicate và tự loại `targetOrderId` nếu xuất hiện trong `sourceOrderIds`.

## Success response (200)

```json
{
  "status": "success",
  "message": "Ghép đơn thành công.",
  "data": {
    "merge": {
      "targetOrderId": "11111111-1111-4111-8111-111111111111",
      "customerId": "33333333-3333-4333-8333-333333333333",
      "mergedOrderIds": [
        "11111111-1111-4111-8111-111111111111",
        "22222222-2222-4222-8222-222222222222"
      ],
      "deletedOrderIds": ["22222222-2222-4222-8222-222222222222"],
      "mergedItemCount": 2,
      "order": { "...": "full target order (products, shipment, customerAddressData)" },
      "orders": [
        {
          "id": "11111111-1111-4111-8111-111111111111",
          "orderCode": "ORD-0001",
          "status": "draft",
          "shippingStatus": "pending",
          "totalAmount": 120000,
          "codAmount": 120000,
          "createdAt": "2026-08-14T08:00:00.000Z"
        }
      ]
    }
  }
}
```

`data.merge.orders` là **list mới của customer đích sau khi merge** — cùng shape với `GET /api/customers/:customerId/orders`. Mobile replace list này thay vì tự xoá `deletedOrderIds`.

## Error responses

| Case | Status | Code |
|---|---|---|
| Body thiếu / sai uuid / `sourceOrderIds` rỗng | 400 | `VALIDATION_ERROR` |
| Đơn đích chưa có customer | 400 | `BAD_REQUEST` |
| Có đơn không `draft` hoặc khác customer | 400 | `BAD_REQUEST` |
| Có đơn đã có vận đơn | 400 | `BAD_REQUEST` |
| Thiếu đơn / không tìm thấy đơn đích | 404 | `NOT_FOUND` |

Message tiếng Việt nằm trong `message`; Mobile hiển thị trực tiếp.

## Behavior notes

- Toàn bộ thao tác chạy trong một transaction: move `order_items`, re-link `live_comments`, xoá đơn nguồn, recalc totals đơn đích, giảm `customers.totalOrders`.
- `customers.totalSpent` không đổi.
- Sau merge, nếu đang xem list toàn shop, Mobile có thể refetch `GET /api/orders`; nếu đang xem list của customer, dùng ngay `data.merge.orders`.

## Mobile checklist

- [ ] Gọi endpoint qua request wrapper hiện có; không fetch/Axios trực tiếp trong component.
- [ ] Disable nút merge nếu selection < 2 orders.
- [ ] Sau success: replace customer order list bằng `data.merge.orders`; cập nhật detail bằng `data.merge.order`.
- [ ] Hiển thị `message` từ response khi 400/404.
