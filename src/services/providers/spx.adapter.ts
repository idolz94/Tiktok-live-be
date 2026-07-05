import { ApiError } from "../../lib/api-error.js";

// SPX address version 2 uses state + city + detailAddress, no district.
const SPX_DEFAULT_SENDER = {
  state: "Tỉnh Lạng Sơn",
  city: "Xã Bắc Sơn",
  detailAddress: "Khối Phố Minh Khai",
};
const SPX_DEFAULT_RECEIVER = {
  state: "Tỉnh An Giang",
  city: "Xã An Phú",
  detailAddress: "Số nhà 37, Ấp An Hưng",
};
import { getSpxCredentials } from "./credentials.js";
import {
  spxBatchCheckFee,
  spxCancelOrder,
  spxCheckCredentials,
  spxCreateOrder,
  spxEstimateAddressAdjustmentFee,
  spxGetOrderFee,
  spxGetTracking,
  spxListVouchers,
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

      const fee = await spxBatchCheckFee({
        environment: creds.environment,
        userId: creds.userId,
        userSecret: creds.userSecret,
        orderId: params.orderId,
        serviceType: 1,
        parcelWeightKg: params.weight ? params.weight / 1000 : 0.3,
        senderState: params.pickProvince || SPX_DEFAULT_SENDER.state,
        senderCity: params.pickWard || SPX_DEFAULT_SENDER.city,
        senderDetailAddress: params.pickAddress || SPX_DEFAULT_SENDER.detailAddress,
        deliverState: params.receiverProvince || SPX_DEFAULT_RECEIVER.state,
        deliverCity: params.receiverWard || SPX_DEFAULT_RECEIVER.city,
        deliverDetailAddress: params.receiverAddress || SPX_DEFAULT_RECEIVER.detailAddress,
      });

      return { providerCode: "spx", fee: fee.fee, edtMin: fee.edtMin, edtMax: fee.edtMax };
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
          pickupTime: spx.spxPickupTime,
          pickupTimeRangeId: spx.spxPickupTimeRangeId,
          pickupTimeRange: spx.spxPickupTimeRange,
          paymentRole: spx.spxPaymentRole ?? 1,
          highValueProcessingCollection: 0,
          parcelWeightGram: spx.parcelWeightGram ?? 300,
          parcelLengthCm: spx.parcelLengthCm,
          parcelWidthCm: spx.parcelWidthCm,
          parcelHeightCm: spx.parcelHeightCm,
          parcelItemName: spx.parcelItemName ?? "Hàng hóa",
          declaredValue: spx.declaredValue,
          codAmount: spx.codAmount ?? 0,
          voucherCode: spx.voucherCode,
          allowMutualCheck: spx.spxAllowMutualCheck,
          allowTryOn: spx.spxAllowTryOn,
          allowPartialDelivery: spx.spxAllowPartialDelivery,
          orderId: params.orderId,
          senderName: params.pickName,
          senderPhone: params.pickTel,
          senderState: params.pickProvince || SPX_DEFAULT_SENDER.state,
          senderCity: params.pickWard || SPX_DEFAULT_SENDER.city,
          senderDetailAddress: params.pickAddress || SPX_DEFAULT_SENDER.detailAddress,
          deliverName: params.receiverName,
          deliverPhone: params.receiverTel,
          deliverState: params.receiverProvince || SPX_DEFAULT_RECEIVER.state,
          deliverCity: params.receiverWard || SPX_DEFAULT_RECEIVER.city,
          deliverDetailAddress: params.receiverAddress || SPX_DEFAULT_RECEIVER.detailAddress,
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
        trackingLink: result.trackingLink ?? null,
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

export async function spxEstimateAdjustmentFee(shopId: string, params: {
  trackingNo: string;
  senderState: string;
  senderCity: string;
  senderPostCode: string;
  senderDetailAddress: string;
  deliverState: string;
  deliverCity: string;
  deliverPostCode: string;
  deliverDetailAddress: string;
}) {
  const creds = await getSpxCredentials(shopId);
  return spxEstimateAddressAdjustmentFee({
    environment: creds.environment,
    userId: creds.userId,
    userSecret: creds.userSecret,
    ...params,
  });
}

export async function spxGetOrderFeeForShop(shopId: string, trackingNo: string) {
  const creds = await getSpxCredentials(shopId);
  return spxGetOrderFee({ environment: creds.environment, userId: creds.userId, userSecret: creds.userSecret, trackingNo });
}

export async function spxCheckCredentialsForShop(shopId: string) {
  const creds = await getSpxCredentials(shopId);
  return spxCheckCredentials({ environment: creds.environment, userId: creds.userId, userSecret: creds.userSecret });
}

export async function spxListVouchersForShop(shopId: string) {
  const creds = await getSpxCredentials(shopId);
  return spxListVouchers({ environment: creds.environment, userId: creds.userId, userSecret: creds.userSecret });
}

// Extended params passed from the SPX-specific route handler
export type SpxShippingSubmitParams = ShippingSubmitParams & {
  spxServiceType?: 1 | 2;
  spxCollectType?: 1 | 2;
  spxPickupTimeRangeId?: number;
  spxPickupTime?: number;
  spxPickupTimeRange?: string;
  spxPaymentRole?: 1 | 2;
  spxAllowMutualCheck?: 0 | 1;
  spxAllowTryOn?: 0 | 1;
  spxAllowPartialDelivery?: 0 | 1;
  parcelWeightGram?: number;
  parcelLengthCm?: number;
  parcelWidthCm?: number;
  parcelHeightCm?: number;
  parcelItemName?: string;
  declaredValue?: number;
  codAmount?: number;
  voucherCode?: string;
};
