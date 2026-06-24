import { ApiError } from "../../lib/api-error.js";
import { getSpxCredentials } from "./credentials.js";
import {
  spxCancelOrder,
  spxCreateOrder,
  spxGetFee,
  spxGetTracking,
} from "./spx.service.js";
import type {
  ShippingCancelParams,
  ShippingCancelResult,
  ShippingFeeParams,
  ShippingFeeResult,
  ShippingProviderAdapter,
  ShippingSubmitParams,
  ShippingSubmitResult,
  ShippingTrackingParams,
  ShippingTrackingResult,
} from "./types.js";

// SPX status_code → Lumi normalized status
export const SPX_STATUS_MAP: Record<number, string> = {
  1001: "pending_pickup",
  2001: "in_transit",
  2006: "delivering",
  3001: "on_hold",
  4001: "delivered",
  5001: "pickup_failed",
  5002: "damaged",
  5003: "lost",
  6001: "returning",
  6002: "return_failed",
  6003: "returned",
  7001: "cancelled",
};

export function mapSpxStatus(statusCode: number): string {
  return SPX_STATUS_MAP[statusCode] ?? "unknown";
}

export function createSpxAdapter(): ShippingProviderAdapter {
  return {
    code: "spx",

    async getFee(params: ShippingFeeParams): Promise<ShippingFeeResult> {
      const creds = await getSpxCredentials(params.shopId);

      // SPX VN: district→senderCity, ward→senderDistrict
      const fee = await spxGetFee({
        environment: creds.environment,
        userId: creds.userId,
        userSecret: creds.userSecret,
        parcelWeightGram: (params as any).parcelWeightGram ?? 300,
        codAmount: (params as any).codAmount ?? 0,
        serviceType: (params as any).serviceType ?? 1,
        senderState: params.pickProvince,
        senderCity: params.pickDistrict,
        senderDistrict: params.pickWard ?? "",
        deliverState: params.receiverProvince,
        deliverCity: params.receiverDistrict,
        deliverDistrict: params.receiverWard ?? "",
      });

      return { providerCode: "spx", fee: fee.fee };
    },

    async submit(params: ShippingSubmitParams): Promise<ShippingSubmitResult> {
      const creds = await getSpxCredentials(params.shopId);
      const spx = params as SpxShippingSubmitParams;

      // SPX VN address quirk: district→city, ward→district
      let result;
      try {
        result = await spxCreateOrder({
          environment: creds.environment,
          userId: creds.userId,
          userSecret: creds.userSecret,
          serviceType: spx.spxServiceType ?? 1,
          collectType: spx.spxCollectType ?? 1,
          pickupTimeRangeId: spx.spxPickupTimeRangeId,
          parcelWeightGram: spx.parcelWeightGram ?? 300,
          parcelLengthCm: spx.parcelLengthCm,
          parcelWidthCm: spx.parcelWidthCm,
          parcelHeightCm: spx.parcelHeightCm,
          parcelItemName: spx.parcelItemName ?? "Hàng hóa",
          declaredValue: spx.declaredValue,
          codAmount: spx.codAmount ?? 0,
          orderId: params.orderId,
          senderName: params.pickName,
          senderPhone: params.pickTel,
          senderState: params.pickProvince,
          senderCity: params.pickDistrict,           // SPX VN: district
          senderDistrict: params.pickWard ?? "",     // SPX VN: ward
          senderDetailAddress: params.pickAddress ?? "",
          deliverName: params.receiverName,
          deliverPhone: params.receiverTel,
          deliverState: params.receiverProvince,
          deliverCity: params.receiverDistrict,      // SPX VN: district
          deliverDistrict: params.receiverWard,      // SPX VN: ward
          deliverDetailAddress: params.receiverAddress ?? "",
        });
      } catch (err) {
        // Surface as outcome_unknown on network timeout so caller marks the row correctly
        if (err instanceof ApiError && err.code === "SPX_NETWORK_ERROR") {
          return {
            providerCode: "spx",
            trackingLabel: "",
            status: "outcome_unknown",
            errorCode: "SPX_NETWORK_ERROR",
            errorMessage: err.message,
          } as ShippingSubmitResult & { errorCode?: string; errorMessage?: string };
        }
        throw err;
      }

      return {
        providerCode: "spx",
        trackingLabel: result.trackingNo,
        trackingCode: result.trackingNo,
        externalOrderId: result.trackingNo,
        fee: result.providerShippingFee,
        status: "pending_pickup",
        statusCode: "1001",
        statusRaw: "1001",
        spxTrackingNo: result.trackingNo,
        spxPickupTime: result.pickupTime,
      } as ShippingSubmitResult & { spxTrackingNo?: string; spxPickupTime?: number };
    },

    async tracking(params: ShippingTrackingParams): Promise<ShippingTrackingResult> {
      const orderService = await import("../orders.service.js");
      const order = await orderService.__getOrderForShipping(params.orderId, params.shopId);
      const trackingNo = order.shipment?.spxTrackingNo ?? order.shipment?.trackingLabel;
      if (!trackingNo) throw new ApiError(400, "Đơn hàng chưa có mã SPX để tra cứu.", "SPX_TRACKING_MISSING");

      const creds = await getSpxCredentials(params.shopId);
      const result = await spxGetTracking({
        environment: creds.environment,
        userId: creds.userId,
        userSecret: creds.userSecret,
        trackingNo,
      });

      return {
        providerCode: "spx",
        trackingCode: result.trackingNo,
        status: mapSpxStatus(result.statusCode),
        statusCode: String(result.statusCode),
        statusText: result.statusText,
        message: null,
        raw: result,
      };
    },

    async cancel(params: ShippingCancelParams): Promise<ShippingCancelResult> {
      const trackingNo = params.trackingId ?? "";
      if (!trackingNo) throw new ApiError(400, "Không có mã SPX để hủy.", "SPX_TRACKING_MISSING");

      // Verify status allows cancellation (only pending_pickup = 1001)
      // The caller (orders.service) has already fetched the shipment; we get trackingId from it.
      const creds = await getSpxCredentials(params.shopId);
      await spxCancelOrder({
        environment: creds.environment,
        userId: creds.userId,
        userSecret: creds.userSecret,
        trackingNo,
      });

      return { providerCode: "spx", status: "cancelled", logId: null };
    },
  };
}

// Extended params passed from the SPX-specific route handler
export type SpxShippingSubmitParams = ShippingSubmitParams & {
  spxServiceType?: 1 | 2;
  spxCollectType?: 1 | 2;
  spxPickupTimeRangeId?: number;
  parcelWeightGram?: number;
  parcelLengthCm?: number;
  parcelWidthCm?: number;
  parcelHeightCm?: number;
  parcelItemName?: string;
  declaredValue?: number;
  codAmount?: number;
};
