import express from "express";
import cookieParser from "cookie-parser";
import { afterEach, describe, expect, it, vi } from "vitest";
import ordersRoutes from "./orders.routes.js";
import { errorHandler } from "../middlewares/error.js";
import { badRequest } from "../lib/api-error.js";
import { createOrderFromComment } from "../services/orders.service.js";

vi.mock("../services/auth.service.js", () => ({
  verifyAccessToken: vi.fn(() => ({ sub: "user-1" })),
  getActiveUserRole: vi.fn(async () => "owner"),
}));

vi.mock("../services/account.service.js", () => ({
  requireUsableAccountContext: vi.fn(async () => ({
    userId: "user-1",
    user: null,
    shopMember: null,
    shop: { id: "shop-1" },
    license: null,
    canUseApp: true,
    reason: null,
  })),
}));

vi.mock("../services/orders.service.js", () => ({
  addOrderItem: vi.fn(),
  cancelShipment: vi.fn(),
  createOrderFromComment: vi.fn(),
  createSpxShipment: vi.fn(),
  deleteOrder: vi.fn(),
  getShippingFee: vi.fn(),
  getShippingTracking: vi.fn(),
  getSpxShipmentLabel: vi.fn(),
  getSpxTimeslots: vi.fn(),
  listSpxVouchers: vi.fn(),
  refreshShippingStatus: vi.fn(),
  listOrdersLight: vi.fn(),
  listShippingOrdersWithShipment: vi.fn(),
  getOrderById: vi.fn(),
  getOrderStats: vi.fn(),
  removeOrderItem: vi.fn(),
  submitManualShipping: vi.fn(),
  updateOrder: vi.fn(),
  updateSpxShipment: vi.fn(),
  updateOrderDepositStatus: vi.fn(),
  updateOrderStatus: vi.fn(),
  updateOrderItem: vi.fn(),
}));

function createTestServer() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/orders", ordersRoutes);
  app.use(errorHandler);

  return new Promise<{ baseUrl: string; close: () => Promise<void> }>((resolve, reject) => {
    const server = app.listen(0, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Unable to start test server"));
        return;
      }
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

const validComment = {
  id: "comment-1",
  liveSessionId: "session-1",
  commentText: "mua x2 giá 695k",
  tiktokUsername: "buyer_1",
};

describe("POST /api/orders/from-comment validation", () => {
  const servers: Array<{ close: () => Promise<void> }> = [];

  afterEach(async () => {
    vi.clearAllMocks();
    await Promise.all(servers.splice(0).map((server) => server.close()));
  });

  it.each([
    ["zero", 0],
    ["negative", -1],
    ["decimal", 2.5],
    ["above upper bound", 10000],
  ])("rejects %s quantity with 400 before calling the service", async (_label, quantity) => {
    const { baseUrl, close } = await createTestServer();
    servers.push({ close });

    const response = await fetch(`${baseUrl}/api/orders/from-comment`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
      body: JSON.stringify({ comment: validComment, quantity }),
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(createOrderFromComment).not.toHaveBeenCalled();
  });

  it.each([
    ["negative", -1],
    ["decimal", 2.5],
  ])("rejects %s price with 400 before calling the service", async (_label, price) => {
    const { baseUrl, close } = await createTestServer();
    servers.push({ close });

    const response = await fetch(`${baseUrl}/api/orders/from-comment`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
      body: JSON.stringify({ comment: validComment, price }),
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(createOrderFromComment).not.toHaveBeenCalled();
  });

  it("creates an order when the body is valid", async () => {
    vi.mocked(createOrderFromComment).mockResolvedValueOnce({
      success: true,
      message: "Tạo đơn thành công.",
      orderId: "order-1",
      orderCode: "ORD-0001",
      presetMatched: { code: "A01", name: "Áo thun", price: 50000 },
    });

    const { baseUrl, close } = await createTestServer();
    servers.push({ close });

    const response = await fetch(`${baseUrl}/api/orders/from-comment`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
      body: JSON.stringify({ comment: validComment, quantity: 2, price: 50000 }),
    });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.status).toBe("success");
    expect(body.data.orderId).toBe("order-1");
    expect(createOrderFromComment).toHaveBeenCalledWith({
      shopId: "shop-1",
      userId: "user-1",
      comment: validComment,
      liveSessionId: undefined,
      customerAddressId: undefined,
      quantity: 2,
      note: "",
    });
  });

  it("surfaces the unmatched-preset business error without a partial write", async () => {
    vi.mocked(createOrderFromComment).mockRejectedValueOnce(
      badRequest("Không tìm thấy sản phẩm phù hợp trong preset. Vui lòng chọn hoặc tạo preset trước khi tạo đơn từ bình luận."),
    );

    const { baseUrl, close } = await createTestServer();
    servers.push({ close });

    const response = await fetch(`${baseUrl}/api/orders/from-comment`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
      body: JSON.stringify({ comment: validComment }),
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe("BAD_REQUEST");
    expect(body.message).toContain("preset");
  });
});
