import crypto from "node:crypto";
import { ApiError } from "../../lib/api-error.js";
import { env } from "../../config/env.js";
import { getSpxErrorMessage } from "./spx.errors.js";

type SpxResponse = {
  errcode: number;
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

function buildSign(payload: string): string {
  const appId = env.spxAppId;
  const appSecret = env.spxAppSecret;
  if (!appId || !appSecret) throw new ApiError(500, "SPX app credentials chưa được cấu hình.", "SPX_APP_CREDS_MISSING");
  const timestamp = Math.floor(Date.now() / 1000);
  const randomNum = Math.floor(Math.random() * 1_000_000);
  const raw = `${appId}_${timestamp}_${randomNum}_${payload}`;
  const sign = crypto.createHmac("sha256", appSecret).update(raw).digest("hex");
  return `${appId}_${timestamp}_${randomNum}_${sign}`;
}

function throwSpxError(res: SpxResponse): never {
  const code = res.error_code ?? res.errcode;
  const raw = res.error_msg || res.message || "";
  const msg = getSpxErrorMessage(typeof code === "number" ? code : undefined, raw);
  throw new ApiError(422, msg, "SPX_ERROR", { errorCode: code, raw });
}

async function spxPost(path: string, environment: string, body: unknown): Promise<unknown> {
  const payload = JSON.stringify(body);
  const checkSign = buildSign(payload);

  let res: Response;
  try {
    res = await fetch(`${spxBase(environment)}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "check-sign": checkSign,
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

  if (data.errcode !== 0) throwSpxError(data);
  return data.data;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export type SpxCreateOrderParams = {
  environment: string;
  userId: number;
  userSecret: string;
  serviceType: 1 | 2;
  collectType: 1 | 2;
  pickupTimeRangeId?: number;
  parcelWeightGram: number;
  parcelLengthCm?: number;
  parcelWidthCm?: number;
  parcelHeightCm?: number;
  parcelItemName: string;
  declaredValue?: number;
  codAmount: number;
  orderId: string;
  senderName: string;
  senderPhone: string;
  senderState: string;
  senderCity: string;
  senderDistrict: string;
  senderDetailAddress: string;
  deliverName: string;
  deliverPhone: string;
  deliverState: string;
  deliverCity: string;
  deliverDistrict: string;
  deliverDetailAddress: string;
};

export type SpxCreateOrderResult = {
  trackingNo: string;
  providerShippingFee: number;
  pickupTime?: number;
};

export async function spxCreateOrder(params: SpxCreateOrderParams): Promise<SpxCreateOrderResult> {
  const orderList: Record<string, unknown> = {
    order_id: params.orderId,
    sender_real_name: params.senderName,
    sender_phone_number: params.senderPhone,
    sender_state: params.senderState,
    sender_city: params.senderCity,
    sender_district: params.senderDistrict,
    sender_detail_address: params.senderDetailAddress,
    deliver_real_name: params.deliverName,
    deliver_phone_number: params.deliverPhone,
    deliver_state: params.deliverState,
    deliver_city: params.deliverCity,
    deliver_district: params.deliverDistrict,
    deliver_detail_address: params.deliverDetailAddress,
    parcel_weight: params.parcelWeightGram,
    parcel_length: params.parcelLengthCm ?? 0,
    parcel_width: params.parcelWidthCm ?? 0,
    parcel_height: params.parcelHeightCm ?? 0,
    parcel_item_name: params.parcelItemName,
    declared_value: params.declaredValue ?? 0,
    cod: params.codAmount,
    service_type: params.serviceType,
    collect_type: params.collectType,
  };

  if (params.collectType === 1 && params.pickupTimeRangeId) {
    orderList["pickup_time_id"] = params.pickupTimeRangeId;
  }

  const body = {
    user_id: params.userId,
    user_secret: params.userSecret,
    order_list: [orderList],
  };

  const data = await spxPost("/open/api/v1/order/batch_create_order", params.environment, body) as Record<string, unknown>;
  const orders = data["order_list"] as Array<Record<string, unknown>>;
  const first = orders?.[0];
  if (!first) throw new ApiError(502, "SPX không trả về kết quả tạo đơn.", "SPX_EMPTY_RESULT");

  return {
    trackingNo: String(first["tracking_no"] ?? ""),
    providerShippingFee: Number(first["estimated_shipping_fee"] ?? 0),
    pickupTime: first["pickup_time"] ? Number(first["pickup_time"]) : undefined,
  };
}

export type SpxTrackingResult = {
  trackingNo: string;
  statusCode: number;
  statusText: string;
};

export async function spxGetTracking(params: { environment: string; userId: number; userSecret: string; trackingNo: string }): Promise<SpxTrackingResult> {
  const body = { user_id: params.userId, user_secret: params.userSecret, tracking_no: params.trackingNo };
  const data = await spxPost("/open/api/v1/order/get_tracking_info", params.environment, body) as Record<string, unknown>;
  return {
    trackingNo: String(data["tracking_no"] ?? params.trackingNo),
    statusCode: Number(data["status_code"] ?? 0),
    statusText: String(data["status_text"] ?? ""),
  };
}

export async function spxCancelOrder(params: { environment: string; userId: number; userSecret: string; trackingNo: string }): Promise<void> {
  const body = {
    user_id: params.userId,
    user_secret: params.userSecret,
    tracking_no_list: [params.trackingNo],
  };
  await spxPost("/open/api/v1/order/cancel", params.environment, body);
}

export type SpxLabelResult = { trackingNo: string; labelUrl: string };

export async function spxGetLabel(params: { environment: string; userId: number; userSecret: string; trackingNo: string }): Promise<SpxLabelResult> {
  const body = {
    user_id: params.userId,
    user_secret: params.userSecret,
    tracking_no_list: [params.trackingNo],
  };
  const data = await spxPost("/open/api/v1/order/get_airway_bill", params.environment, body) as Record<string, unknown>;
  const list = data["airway_bill_list"] as Array<Record<string, unknown>>;
  const first = list?.[0];
  if (!first) throw new ApiError(502, "SPX không trả về URL nhãn.", "SPX_LABEL_EMPTY");
  return {
    trackingNo: String(first["tracking_no"] ?? params.trackingNo),
    labelUrl: String(first["airway_bill_url"] ?? ""),
  };
}

export type SpxFeeResult = { fee: number };

export async function spxGetFee(params: {
  environment: string;
  userId: number;
  userSecret: string;
  parcelWeightGram: number;
  codAmount: number;
  serviceType: 1 | 2;
  senderState: string;
  senderCity: string;
  senderDistrict: string;
  deliverState: string;
  deliverCity: string;
  deliverDistrict: string;
}): Promise<SpxFeeResult> {
  const body = {
    user_id: params.userId,
    user_secret: params.userSecret,
    sender_state: params.senderState,
    sender_city: params.senderCity,
    sender_district: params.senderDistrict,
    deliver_state: params.deliverState,
    deliver_city: params.deliverCity,
    deliver_district: params.deliverDistrict,
    parcel_weight: params.parcelWeightGram,
    cod: params.codAmount,
    service_type: params.serviceType,
  };
  const data = await spxPost("/open/api/v1/order/get_shipping_fee", params.environment, body) as Record<string, unknown>;
  return { fee: Number(data["estimated_shipping_fee"] ?? 0) };
}

export type SpxTimeslot = { id: number; name: string; startTime: number; endTime: number };

export async function spxGetTimeslots(params: {
  environment: string;
  userId: number;
  userSecret: string;
  pickupDate: string;
}): Promise<SpxTimeslot[]> {
  const body = { user_id: params.userId, user_secret: params.userSecret, pickup_date: params.pickupDate };
  const data = await spxPost("/open/api/v1/order/get_pickup_time", params.environment, body) as Record<string, unknown>;
  const list = data["pickup_time_list"] as Array<Record<string, unknown>> ?? [];
  return list.map((t) => ({
    id: Number(t["pickup_time_id"] ?? 0),
    name: String(t["pickup_time_name"] ?? ""),
    startTime: Number(t["start_time"] ?? 0),
    endTime: Number(t["end_time"] ?? 0),
  }));
}
