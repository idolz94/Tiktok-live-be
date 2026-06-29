import { createHmac } from "crypto";
import { ApiError } from "../../lib/api-error.js";
import { env } from "../../config/env.js";
import { getSpxErrorMessage } from "./spx.errors.js";

function toE164VN(phone: string): string {
  return phone.startsWith("0") ? "84" + phone.slice(1) : phone;
}
type SpxResponse = {
  ret_code: number;
  message?: string;
  error_type?: string;
  error_code?: number;
  error_msg?: string;
  data?: unknown;
};

function spxBase(environment: string): string {
  if (environment === "sandbox") return "https://test-stable.spx.vn";
  if (env.spxApiBase && environment === "production") return "https://spx.vn";
  return env.spxApiBase || "https://test-stable.spx.vn";
}

function throwSpxError(res: SpxResponse): never {
  const code = res.error_code ?? res.ret_code;
  const raw = res.error_msg || res.message || "";
  const msg = getSpxErrorMessage(typeof code === "number" ? code : undefined, raw);
  throw new ApiError(422, msg, "SPX_ERROR", { errorCode: code, raw });
}

async function spxPost(path: string, environment: string, body: unknown): Promise<unknown> {
  const appId = env.spxAppId;
  const appSecret = env.spxAppSecret;
  if (!appId || !appSecret) throw new ApiError(500, "SPX app credentials chưa được cấu hình.", "SPX_APP_CREDS_MISSING");
  const payload = JSON.stringify(body);
  const timestamp = Math.floor(Date.now() / 1000);
  const randomNum = Math.floor(Math.random() * 1_000_000);
  const checkSign = createHmac("sha256", appSecret)
    .update(`${appId}_${timestamp}_${randomNum}_${payload}`)
    .digest("hex");
  const spxHeaders = {
    "app-id": appId,
    "check-sign": checkSign,
    "timestamp": String(timestamp),
    "random-num": String(randomNum),
  };

  let res: Response;
  try {
    res = await fetch(`${spxBase(environment)}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...spxHeaders,
      },
      body: payload,
    });
  } catch (err) {
    throw new ApiError(504, "Không kết nối được đến SPX.", "SPX_NETWORK_ERROR", { cause: String(err) });
  }

  let data: SpxResponse;
  try {
    data = (await res.json()) as SpxResponse;
  } catch {
    throw new ApiError(502, "Không đọc được phản hồi từ SPX.", "SPX_PARSE_ERROR");
  }

  if (!path.includes("get_pickup_time")) {
    const curlHeaders = Object.entries({ "Content-Type": "application/json", ...spxHeaders })
      .map(([k, v]) => `-H '${k}: ${v}'`)
      .join(" \\\n  ");
    console.log(`[SPX curl] curl -X POST '${spxBase(environment)}${path}' \\\n  ${curlHeaders} \\\n  -d '${payload}'`);
    console.log("[SPX response]", JSON.stringify(data));
  }

  if (data.ret_code !== 0) throwSpxError(data);
  return data.data;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function spxCreateAccount(params: { phone: string; email?: string }): Promise<{ userId: number; userSecret: string }> {
  const body = params.email ? { phone: params.phone, email: params.email } : { phone: params.phone };
  const data = await spxPost("/open/api/v1/account/create", env.spxApiBase || "sandbox", body) as Record<string, unknown>;
  return { userId: Number(data["user_id"]), userSecret: String(data["user_secret"]) };
}



export type SpxOrderItem = {
  itemName: string;
  itemWeightGram: number;
  itemPrice: number;
  itemQuantity: number;
  itemPicture?: string;
};

export type SpxCreateOrderParams = {
  environment: string;
  userId: number;
  userSecret: string;
  serviceType: 1 | 2;
  collectType: 1 | 2;
  pickupTime?: number;
  pickupTimeRangeId?: number;
  pickupTimeRange?: string;
  paymentRole: 1 | 2;
  highValueProcessingCollection: 0 | 1;
  parcelWeightGram: number;
  parcelLengthCm?: number;
  parcelWidthCm?: number;
  parcelHeightCm?: number;
  parcelItemName: string;
  declaredValue?: number;
  codAmount: number;
  voucherCode?: string;
  orderId: string;
  senderName: string;
  senderPhone: string;
  senderState: string;
  senderCity: string;
  senderDetailAddress: string;
  deliverName: string;
  deliverPhone: string;
  deliverState: string;
  deliverCity: string;
  deliverDetailAddress: string;
  itemList?: SpxOrderItem[];
};

export type SpxCreateOrderResult = {
  trackingNo: string;
  providerShippingFee: number;
  pickupTime?: number;
};

export async function spxCreateOrder(params: SpxCreateOrderParams): Promise<SpxCreateOrderResult> {
  const isCod = params.codAmount > 0;
  const insuredValue = params.declaredValue ?? 0;
  // VN: high_value_processing_collection must be 1 when express_insured_value >= 3_000_000
  const highValue = insuredValue >= 3_000_000 ? 1 : params.highValueProcessingCollection;

  const spxOrderId = params.orderId.replace(/-/g, "").slice(0, 32);

  const order: Record<string, unknown> = {
    order_id: spxOrderId,
    sender_info: {
      sender_name: params.senderName,
      sender_phone: toE164VN(params.senderPhone),
      sender_state: params.senderState,
      sender_city: params.senderCity,
      sender_detail_address: params.senderDetailAddress,
      sender_address_version: 2,
    },
    deliver_info: {
      deliver_name: params.deliverName,
      deliver_phone: toE164VN(params.deliverPhone),
      deliver_state: params.deliverState,
      deliver_city: params.deliverCity,
      deliver_detail_address: params.deliverDetailAddress,
      deliver_address_version: 2,
    },
    base_info: {
      service_type: params.serviceType,
    },
    fulfillment_info: {
      collect_type: params.collectType,
      payment_role: params.paymentRole,
      high_value_processing_collection: highValue,
      cod_collection: isCod ? 1 : 0,
      cod_amount: isCod ? params.codAmount : 0,
      ...(params.voucherCode ? { voucher_code: params.voucherCode } : {}),
      ...(params.collectType === 1 && params.pickupTime ? { pickup_time: params.pickupTime } : {}),
      ...(params.collectType === 1 && params.pickupTimeRangeId ? { pickup_time_range_id: params.pickupTimeRangeId } : {}),
    },
    parcel_info: {
      parcel_weight: params.parcelWeightGram / 1000,
      parcel_length: params.parcelLengthCm ?? 0,
      parcel_width: params.parcelWidthCm ?? 0,
      parcel_height: params.parcelHeightCm ?? 0,
      parcel_item_name: params.parcelItemName,
      parcel_item_quantity: 1,
      express_insured_value: insuredValue,
      item_list: params.itemList?.map((it) => ({
        item_name: it.itemName,
        item_weight: String(it.itemWeightGram),
        item_price: String(it.itemPrice),
        item_quantity: it.itemQuantity,
        ...(it.itemPicture ? { item_picture: it.itemPicture } : {}),
      })),
    },
  };

  const body = {
    user_id: params.userId,
    user_secret: params.userSecret,
    orders: [order],
  };

  const data = await spxPost("/open/api/v1/order/batch_create_order", params.environment, body) as Record<string, unknown>;
  const orders = data["orders"] as Array<Record<string, unknown>>;
  const first = orders?.[0];
  if (!first) {
    const failList = data["fail_list"] as Array<Record<string, unknown>> | undefined;
    const fail = failList?.[0];
    const reason = fail ? `${fail["message"] ?? fail["debug_msg"] ?? "Unknown"} (code: ${fail["ret_code"] ?? "?"})` : "SPX không trả về kết quả tạo đơn.";
    throw new ApiError(422, String(reason), "SPX_CREATE_FAILED", { fail });
  }

  return {
    trackingNo: String(first["tracking_no"] ?? ""),
    providerShippingFee: Number(first["estimated_shipping_fee"] ?? 0),
    pickupTime: first["pickup_time"] ? Number(first["pickup_time"]) : undefined,
  };
}

export type SpxTrackingResult = {
  trackingNo: string;
  trackingLink: string | null;
  statusCode: number;
  statusText: string;
};

export async function spxGetTracking(params: { environment: string; userId: number; userSecret: string; trackingNo: string }): Promise<SpxTrackingResult> {
  const body = { user_id: params.userId, user_secret: params.userSecret, tracking_no_list: [params.trackingNo] };
  const data = await spxPost("/open/api/v1/order/batch_search_order", params.environment, body) as Record<string, unknown>;
  const orders = data["orders"] as Array<Record<string, unknown>> | undefined;
  const first = orders?.[0];
  if (!first) throw new ApiError(404, "SPX không tìm thấy đơn hàng.", "SPX_TRACKING_NOT_FOUND");
  return {
    trackingNo: String(first["tracking_no"] ?? params.trackingNo),
    trackingLink: first["tracking_link"] ? String(first["tracking_link"]) : null,
    statusCode: Number(first["status_code"] ?? 0),
    statusText: String(first["status_text"] ?? first["status"] ?? ""),
  };
}

export async function spxCancelOrder(params: { environment: string; userId: number; userSecret: string; trackingNo: string }): Promise<void> {
  const body = {
    user_id: params.userId,
    user_secret: params.userSecret,
    tracking_no_list: [params.trackingNo],
  };
  const data = await spxPost("/open/api/v1/order/batch_cancel_order", params.environment, body) as Record<string, unknown> | null;
  const failList = data?.["fail_list"] as Array<{ ret_code: number; message: string; tracking_no: string }> | undefined;
  if (failList && failList.length > 0) {
    const first = failList[0];
    const msg = getSpxErrorMessage(first.ret_code, first.message);
    throw new ApiError(422, msg, "SPX_CANCEL_FAILED", { errorCode: first.ret_code, trackingNo: first.tracking_no });
  }
}

export type SpxLabelResult = { trackingNo: string; labelUrl: string };

export async function spxGetLabel(params: { environment: string; userId: number; userSecret: string; trackingNo: string }): Promise<SpxLabelResult> {
  const body = {
    user_id: params.userId,
    user_secret: params.userSecret,
    tracking_no_list: [params.trackingNo],
  };
  const data = await spxPost("/open/api/v1/order/batch_get_shipping_label", params.environment, body) as Record<string, unknown>;
  const labelUrl = String(data["awb_link"] ?? "");
  if (!labelUrl) throw new ApiError(502, "SPX không trả về URL nhãn.", "SPX_LABEL_EMPTY");
  return { trackingNo: params.trackingNo, labelUrl };
}

export type SpxOrderFeeResult = {
  trackingNo: string;
  actualShippingFee: number;
  actualWeight: number;
  billableWeight: number;
};

export async function spxGetOrderFee(params: { environment: string; userId: number; userSecret: string; trackingNo: string }): Promise<SpxOrderFeeResult> {
  const body = { user_id: params.userId, user_secret: params.userSecret, tracking_no_list: [params.trackingNo] };
  const data = await spxPost("/open/api/v1/order/batch_get_asf", params.environment, body) as Record<string, unknown>;
  const orders = data["orders"] as Array<Record<string, unknown>> | undefined;
  const first = orders?.[0];
  if (!first) {
    const failList = data["fail_list"] as Array<Record<string, unknown>> | undefined;
    const fail = failList?.[0];
    throw new ApiError(422, String(fail?.["message"] ?? "SPX không trả về phí đơn hàng."), "SPX_ORDER_FEE_ERROR", { raw: fail });
  }
  const feeInfo = first["fee_info"] as Record<string, unknown> | undefined ?? {};
  const parcelInfo = first["parcel_info"] as Record<string, unknown> | undefined ?? {};
  return {
    trackingNo: String(first["tracking_no"] ?? params.trackingNo),
    actualShippingFee: Number(feeInfo["actual_shipping_fee"] ?? 0),
    actualWeight: Number(parcelInfo["actual_weight"] ?? 0),
    billableWeight: Number(parcelInfo["billable_weight"] ?? 0),
  };
}

export async function spxCheckCredentials(params: { environment: string; userId: number; userSecret: string }): Promise<void> {
  // ponytail: reuse get_pickup_time as a lightweight credential check — no dedicated endpoint in the docs
  const body = { user_id: params.userId, user_secret: params.userSecret, service_type: 1 };
  await spxPost("/open/api/v1/order/get_pickup_time", params.environment, body);
}

export type SpxFeeResult = {
  fee: number;
  basicFee: number;
  codServiceFee: number;
};

export async function spxBatchCheckFee(params: {
  environment: string;
  userId: number;
  userSecret: string;
  orderId: string;
  serviceType: 1 | 2;
  parcelWeightKg: number;
  parcelLengthCm?: number;
  parcelWidthCm?: number;
  parcelHeightCm?: number;
  codAmount?: number;
  senderState: string;
  senderCity: string;
  senderDetailAddress?: string;
  deliverState: string;
  deliverCity: string;
  deliverDetailAddress?: string;
}): Promise<SpxFeeResult> {
  const body = {
    user_id: params.userId,
    user_secret: params.userSecret,
    orders: [
      {
        base_info: { service_type: params.serviceType },
        sender_info: {
          sender_state: params.senderState,
          sender_city: params.senderCity,
          sender_detail_address: params.senderDetailAddress ?? "",
          sender_address_version: 2,
        },
        fulfillment_info: {
          cod_collection: params.codAmount ? 1 : 0,
          ...(params.codAmount ? { cod_amount: params.codAmount } : {}),
        },
        deliver_info: {
          deliver_state: params.deliverState,
          deliver_city: params.deliverCity,
          deliver_detail_address: params.deliverDetailAddress ?? "",
          deliver_address_version: 2,
        },
        parcel_info: {
          parcel_weight: params.parcelWeightKg,
          parcel_item_name: "Hàng hóa",
          parcel_item_quantity: 1,
          ...(params.parcelLengthCm ? { parcel_length: params.parcelLengthCm } : {}),
          ...(params.parcelWidthCm ? { parcel_width: params.parcelWidthCm } : {}),
          ...(params.parcelHeightCm ? { parcel_height: params.parcelHeightCm } : {}),
        },
      },
    ],
  };

  const data = await spxPost("/open/api/v1/order/batch_check_order", params.environment, body) as Record<string, unknown>;
  const orders = data["orders"] as Array<Record<string, unknown>> | undefined;
  const first = orders?.[0];
  if (!first) {
    const failList = data["fail_list"] as Array<Record<string, unknown>> | undefined;
    const fail = failList?.[0];
    throw new ApiError(422, String(fail?.["message"] ?? "SPX không trả về kết quả tính phí."), "SPX_FEE_ERROR", { errorCode: fail?.["ret_code"], raw: fail });
  }
  return {
    fee: Number(first["estimated_shipping_fee"] ?? 0),
    basicFee: Number(first["basic_shipping_fee"] ?? 0),
    codServiceFee: Number(first["cod_service_fee"] ?? 0),
  };
}

export type SpxEstimateAddressAdjustmentFeeParams = {
  environment: string;
  userId: number;
  userSecret: string;
  trackingNo: string;
  senderState: string;
  senderCity: string;
  senderPostCode: string;
  senderDetailAddress: string;
  senderLongitude?: string;
  senderLatitude?: string;
  deliverState: string;
  deliverCity: string;
  deliverPostCode: string;
  deliverDetailAddress: string;
  deliverLongitude?: string;
  deliverLatitude?: string;
};

export type SpxEstimateAddressAdjustmentFeeResult = {
  estimatedShippingFee: number;
  basicShippingFee: number;
  addressAdjustmentFee: number;
  codServiceFee: number;
};

export async function spxEstimateAddressAdjustmentFee(
  params: SpxEstimateAddressAdjustmentFeeParams,
): Promise<SpxEstimateAddressAdjustmentFeeResult> {
  const body = {
    user_id: params.userId,
    user_secret: params.userSecret,
    tracking_no: params.trackingNo,
    sender_state: params.senderState,
    sender_city: params.senderCity,
    sender_post_code: params.senderPostCode,
    sender_detail_address: params.senderDetailAddress,
    ...(params.senderLongitude && { sender_longitude: params.senderLongitude }),
    ...(params.senderLatitude && { sender_latitude: params.senderLatitude }),
    deliver_state: params.deliverState,
    deliver_city: params.deliverCity,
    deliver_post_code: params.deliverPostCode,
    deliver_detail_address: params.deliverDetailAddress,
    ...(params.deliverLongitude && { deliver_longitude: params.deliverLongitude }),
    ...(params.deliverLatitude && { deliver_latitude: params.deliverLatitude }),
    sender_address_version: 2,
    deliver_address_version: 2,
  };

  const data = await spxPost("/open/api/v1/order/estimate_address_adjustment_fee", params.environment, body) as Record<string, unknown>;
  return {
    estimatedShippingFee: Number(data["estimated_shipping_fee"] ?? 0),
    basicShippingFee: Number(data["basic_shipping_fee"] ?? 0),
    addressAdjustmentFee: Number(data["address_adjustment_fee"] ?? 0),
    codServiceFee: Number(data["cod_service_fee"] ?? 0),
  };
}

export type SpxTimeslot = {
  date: string;
  pickupTime: number;
  slots: Array<{ id: number; range: string }>;
};

export async function spxGetTimeslots(params: {
  environment: string;
  userId: number;
  userSecret: string;
  serviceType?: number;
}): Promise<SpxTimeslot[]> {
  const body = { user_id: params.userId, user_secret: params.userSecret, service_type: params.serviceType ?? 1 };
  const data = await spxPost("/open/api/v1/order/get_pickup_time", params.environment, body) as Array<Record<string, unknown>>;

  if (!Array.isArray(data)) return [];
  return data.map((d) => ({
    date: String(d["date"] ?? ""),
    pickupTime: Number(d["pickup_time"] ?? 0),
    slots: (d["slots"] as Array<Record<string, unknown>> ?? []).map((s) => ({
      id: Number(s["pickup_time_range_id"] ?? 0),
      range: String(s["pickup_time_range"] ?? ""),
    })),
  }));
}

export type SpxVoucher = {
  voucherCode: string;
  voucherName: string;
  discountBy: number;
  voucherAmount: string;
  voucherCap: string;
  minSpend: string;
  validStartTime: number;
  validEndTime: number;
};

export async function spxListVouchers(params: {
  environment: string;
  userId: number;
  userSecret: string;
}): Promise<SpxVoucher[]> {
  const body = { user_id: params.userId, user_secret: params.userSecret };
  const data = await spxPost("/open/api/v1/order/list_voucher", params.environment, body) as Record<string, unknown>;
  const vouchers = data["vouchers"] as Array<Record<string, unknown>> | undefined ?? [];
  return vouchers.map((v) => ({
    voucherCode: String(v["voucher_code"] ?? ""),
    voucherName: String(v["voucher_name"] ?? ""),
    discountBy: Number(v["discount_by"] ?? 0),
    voucherAmount: String(v["voucher_amount"] ?? ""),
    voucherCap: String(v["voucher_cap"] ?? ""),
    minSpend: String(v["min_spend"] ?? ""),
    validStartTime: Number(v["valid_start_time"] ?? 0),
    validEndTime: Number(v["valid_end_time"] ?? 0),
  }));
}
