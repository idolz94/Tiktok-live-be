import { ApiError } from "../../lib/api-error.js";
import { ghtkCancelOrder, ghtkGetFee, ghtkGetTracking, ghtkSubmitOrder } from "./ghtk.service.js";
import { getGhtkToken } from "./credentials.js";
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
  ShippingWebhookStatusParams,
  ShippingWebhookStatusResult,
} from "./types.js";
import { env } from "../../config/env.js";

function mapStatusIdToShippingStatus(statusId: number): string {
  if (statusId === -1) return "cancelled";
  if (statusId === 5 || statusId === 6) return "delivered";
  if (statusId === 9 || statusId === 20 || statusId === 21) return "returned";
  return "submitted";
}

export function createGhtkAdapter(): ShippingProviderAdapter {
  return {
    code: "ghtk",
    async getFee(params: ShippingFeeParams): Promise<ShippingFeeResult> {
      const token = await getGhtkToken(params.shopId);
      if (!token) throw new ApiError(400, "Shop chưa cấu hình token GHTK.", "GHTK_TOKEN_MISSING");

      const result = await ghtkGetFee({
        token,
        partnerCode: env.ghtkPartnerCode,
        pickProvince: params.pickProvince,
        pickDistrict: params.pickDistrict,
        pickWard: params.pickWard,
        pickAddress: params.pickAddress,
        province: params.receiverProvince,
        district: params.receiverDistrict,
        ward: params.receiverWard,
        address: params.receiverAddress,
        weight: params.weight ?? 300,
        transport: params.transport,
      });

      return { providerCode: "ghtk", ...result, raw: result };
    },
    async submit(params: ShippingSubmitParams): Promise<ShippingSubmitResult> {
      const token = await getGhtkToken(params.shopId);
      if (!token) throw new ApiError(400, "Shop chưa cấu hình token GHTK. Vui lòng vào cài đặt để thêm token.", "GHTK_TOKEN_MISSING");

      const orderService = await import("../orders.service.js");
      const order = await orderService.__getOrderForShipping(params.orderId, params.shopId);
      const items = order.items ?? [];
      if (!items.length) throw new ApiError(400, "Đơn hàng chưa có sản phẩm để đăng lên GHTK.", "ORDER_ITEMS_MISSING");

      const ghtkProducts = items.map((item) => ({
        name: item.productName ?? item.productCode ?? "Sản phẩm",
        weight: 0.3,
        quantity: item.quantity ?? 1,
        product_code: item.productCode ?? undefined,
      }));


      const result = await ghtkSubmitOrder({
        token,
        partnerCode: env.ghtkPartnerCode,
        order: {
          id: order.orderCode ?? order.id,
          pickName: params.pickName,
          pickAddress: params.pickAddress || [params.pickWard, params.pickDistrict, params.pickProvince].filter(Boolean).join(", "),
          pickProvince: params.pickProvince,
          pickDistrict: params.pickDistrict,
          pickWard: params.pickWard,
          pickTel: params.pickTel,
          name: params.receiverName,
          address: params.receiverAddress || [params.receiverWard, params.receiverDistrict, params.receiverProvince].filter(Boolean).join(", "),
          province: params.receiverProvince,
          district: params.receiverDistrict,
          ward: params.receiverWard,
          hamlet: params.receiverHamlet,
          tel: params.receiverTel,
          note: params.note ?? order.note ?? "",
          pickMoney: order.subtotalAmount ?? 0,
          value: order.totalAmount ?? 0,
          isFreeShip: params.isFreeShip ?? 0,
          transport: params.transport ?? "road",
          pickOption: params.pickOption ?? "cod",
        },
        products: ghtkProducts,
      });

      return {
        providerCode: "ghtk",
        trackingLabel: result.label,
        trackingCode: String(result.trackingId),
        externalOrderId: String(result.trackingId),
        paymentSide: params.isFreeShip === 1 ? 1 : 0,
        fee: result.fee,
        insuranceFee: result.insuranceFee,
        estimatedPickTime: result.estimatedPickTime ?? null,
        estimatedDeliverTime: result.estimatedDeliverTime ?? null,
        statusCode: String(result.statusId),
        status: mapStatusIdToShippingStatus(result.statusId),
        statusRaw: String(result.statusId),
        rawResponse: result,
      };
    },
    async tracking(params: ShippingTrackingParams): Promise<ShippingTrackingResult> {
      const orderService = await import("../orders.service.js");
      const order = await orderService.__getOrderForShipping(params.orderId, params.shopId);
      const token = await getGhtkToken(params.shopId);
      if (!token) throw new ApiError(400, "Shop chưa cấu hình token GHTK.", "GHTK_TOKEN_MISSING");

      const trackingOrder = order.shipment?.trackingLabel ?? order.orderCode;
      if (!trackingOrder) throw new ApiError(400, "Đơn hàng chưa có mã vận đơn để tra cứu.", "TRACKING_ID_MISSING");

      const result = await ghtkGetTracking({ token, trackingOrder, partnerCode: env.ghtkPartnerCode });
      return {
        providerCode: "ghtk",
        trackingCode: result.labelId,
        status: result.status,
        statusCode: result.status,
        statusText: result.statusText,
        message: result.message,
        raw: result,
      };
    },
    async cancel(params: ShippingCancelParams): Promise<ShippingCancelResult> {
      const token = await getGhtkToken(params.shopId);
      if (!token) throw new ApiError(400, "Shop chưa cấu hình token GHTK. Vui lòng vào cài đặt để thêm token.", "GHTK_TOKEN_MISSING");
      const trackingId = params.trackingId ?? "";
      if (!trackingId) throw new ApiError(400, "Đơn hàng chưa có mã vận đơn để hủy.", "TRACKING_ID_MISSING");

      const result = await ghtkCancelOrder({ token, trackingId });
      return { providerCode: "ghtk", logId: result.logId ?? null, status: "cancelled", raw: result };
    },
    normalizeWebhookStatus(params: ShippingWebhookStatusParams): ShippingWebhookStatusResult {
      return {
        providerCode: "ghtk",
        shippingStatus: mapStatusIdToShippingStatus(params.statusId),
        statusCode: String(params.statusId),
        statusRaw: String(params.statusId),
      };
    },
  };
}
