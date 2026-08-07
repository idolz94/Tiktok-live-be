import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "../../config/env.js";
import { spxUpdateOrder } from "./spx.service.js";

describe("spxUpdateOrder", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends service_type inside base_info for SPX update order", async () => {
    const bodies: unknown[] = [];
    env.spxAppId = "app-id";
    env.spxAppSecret = "app-secret";

    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ ret_code: 0, data: null }), { status: 200 });
      }),
    );

    await spxUpdateOrder({
      environment: "sandbox",
      userId: 123,
      userSecret: "user-secret",
      trackingNo: "SPX123",
      serviceType: 1,
      collectType: 2,
      paymentRole: 1,
      highValueProcessingCollection: 0,
      codAmount: 150000,
      senderName: "Shop",
      senderPhone: "0900000000",
      senderState: "Tỉnh Lạng Sơn",
      senderCity: "Xã Bắc Sơn",
      senderDetailAddress: "Khối Phố Minh Khai",
      deliverName: "Khách",
      deliverPhone: "0911111111",
      deliverState: "Tỉnh An Giang",
      deliverCity: "Xã An Phú",
      deliverDetailAddress: "Số nhà 37, Ấp An Hưng",
      parcelWeightGram: 300,
      parcelItemName: "Áo thun",
    });

    expect(bodies[0]).toMatchObject({
      orders: [
        {
          tracking_no: "SPX123",
          sender_info: {
            sender_name: "Shop",
            sender_phone: "84900000000",
          },
          deliver_info: {
            deliver_name: "Khách",
            deliver_phone: "84911111111",
          },
          base_info: { service_type: 1 },
          fulfillment_info: {
            collect_type: 2,
            payment_role: 1,
            high_value_processing_collection: 0,
            cod_collection: 1,
            cod_amount: 150000,
          },
          parcel_info: {
            parcel_weight: 0.3,
            parcel_item_name: "Áo thun",
            parcel_item_quantity: 1,
          },
        },
      ],
    });
  });

  it("sends pickup_time for pickup SPX update order", async () => {
    const bodies: unknown[] = [];
    env.spxAppId = "app-id";
    env.spxAppSecret = "app-secret";

    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ ret_code: 0, data: null }), { status: 200 });
      }),
    );

    await spxUpdateOrder({
      environment: "sandbox",
      userId: 123,
      userSecret: "user-secret",
      trackingNo: "SPX123",
      serviceType: 1,
      collectType: 1,
      paymentRole: 1,
      highValueProcessingCollection: 0,
      codAmount: 150000,
      senderName: "Shop",
      senderPhone: "0900000000",
      senderState: "Tỉnh Lạng Sơn",
      senderCity: "Xã Bắc Sơn",
      senderDetailAddress: "Khối Phố Minh Khai",
      deliverName: "Khách",
      deliverPhone: "0911111111",
      deliverState: "Tỉnh An Giang",
      deliverCity: "Xã An Phú",
      deliverDetailAddress: "Số nhà 37, Ấp An Hưng",
      pickupTime: 1234567890,
      pickupTimeRangeId: 1,
      parcelWeightGram: 300,
      parcelItemName: "Áo thun",
    });

    expect(bodies[0]).toMatchObject({
      orders: [
        {
          fulfillment_info: {
            collect_type: 1,
            pickup_time: 1234567890,
            pickup_time_range_id: 1,
          },
        },
      ],
    });
  });
});
