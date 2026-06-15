import { and, eq } from "drizzle-orm";
import { db } from "../../lib/db.js";
import { shopSettings } from "../../db/schema/index.js";
import { ApiError } from "../../lib/api-error.js";
import { getGhtkErrorMessage } from "./ghtk.errors.js";
import { env } from "../../config/env.js";

const GHTK_TOKEN_KEY = "ghtk_token";

function getGhtkBase(): string {
  return env.ghtkApiBase || "https://services.giaohangtietkiem.vn";
}

export async function getGhtkToken(shopId: string): Promise<string> {
  const rows = await db
    .select()
    .from(shopSettings)
    .where(and(eq(shopSettings.shopId, shopId), eq(shopSettings.key, GHTK_TOKEN_KEY)))
    .limit(1);

  const val = rows[0]?.value;
  if (typeof val === "string" && val) return val;
  if (val && typeof val === "object" && "token" in val && typeof (val as any).token === "string") {
    return (val as any).token;
  }
  // Fall back to system-level token from env
  return env.ghtkApiToken || "";
}

export async function upsertGhtkToken(shopId: string, token: string): Promise<void> {
  const existing = await db
    .select({ id: shopSettings.id })
    .from(shopSettings)
    .where(and(eq(shopSettings.shopId, shopId), eq(shopSettings.key, GHTK_TOKEN_KEY)))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(shopSettings)
      .set({ value: token, updatedAt: new Date() })
      .where(and(eq(shopSettings.shopId, shopId), eq(shopSettings.key, GHTK_TOKEN_KEY)));
  } else {
    await db.insert(shopSettings).values({ shopId, key: GHTK_TOKEN_KEY, value: token });
  }
}

type GhtkApiResponse = {
  success: boolean;
  message?: string;
  error_code?: number | string;
  log_id?: string;
  [key: string]: unknown;
};

function throwGhtkError(res: GhtkApiResponse): never {
  const userMessage = getGhtkErrorMessage(res.error_code);
  throw new ApiError(422, userMessage, "GHTK_ERROR", {
    ghtkMessage: res.message,
    errorCode: res.error_code,
    logId: res.log_id,
  });
}

async function ghtkGet(
  path: string,
  token: string,
  params: Record<string, string | number | undefined>,
  partnerCode?: string,
): Promise<GhtkApiResponse> {
  const headers: Record<string, string> = { Token: token };
  if (partnerCode) headers["X-Client-Source"] = partnerCode;

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") qs.set(k, String(v));
  }

  const response = await fetch(`${getGhtkBase()}${path}?${qs.toString()}`, { headers });

  let data: GhtkApiResponse;
  try {
    data = (await response.json()) as GhtkApiResponse;
  } catch {
    throw new ApiError(502, "Không đọc được phản hồi từ GHTK.", "GHTK_PARSE_ERROR");
  }

  if (!data.success) throwGhtkError(data);
  return data;
}

async function ghtkPost(
  path: string,
  token: string,
  body: unknown,
  partnerCode?: string,
): Promise<GhtkApiResponse> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Token: token,
  };
  if (partnerCode) headers["X-Client-Source"] = partnerCode;

  const response = await fetch(`${getGhtkBase()}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  let data: GhtkApiResponse;
  try {
    data = (await response.json()) as GhtkApiResponse;
  } catch {
    throw new ApiError(502, "Không đọc được phản hồi từ GHTK.", "GHTK_PARSE_ERROR");
  }

  if (!data.success) {
    throwGhtkError(data);
  }

  return data;
}

export async function ghtkCancelOrder(params: {
  token: string;
  trackingId: string;
}): Promise<{ success: true; logId?: string }> {
  const data = await ghtkPost(
    "/services/shipment/cancel",
    params.token,
    { label_id: params.trackingId },
    env.ghtkPartnerCode,
  );

  return { success: true, logId: String(data.log_id ?? "") };
}

export type GhtkGetFeeParams = {
  token: string;
  partnerCode?: string;
  pickProvince: string;
  pickDistrict: string;
  pickWard?: string;
  pickAddress?: string;
  province: string;
  district: string;
  ward?: string;
  address?: string;
  weight: number;
  value?: number;
  transport?: "road" | "fly";
};

export type GhtkFeeResult = {
  name: string;
  fee: number;
  insuranceFee: number;
  delivery: boolean;
  extFees: Array<{ title: string; amount: number; type: string }>;
};

export async function ghtkGetFee(params: GhtkGetFeeParams): Promise<GhtkFeeResult> {
  const data = await ghtkGet(
    "/services/shipment/fee",
    params.token,
    {
      pick_province: params.pickProvince,
      pick_district: params.pickDistrict,
      pick_ward: params.pickWard,
      pick_address: params.pickAddress,
      province: params.province,
      district: params.district,
      ward: params.ward,
      address: params.address,
      weight: params.weight,
      value: params.value,
      transport: params.transport,
    },
    params.partnerCode,
  );

  const fee = data.fee as Record<string, unknown>;
  return {
    name: String(fee.name ?? ""),
    fee: Number(fee.fee ?? 0),
    insuranceFee: Number(fee.insurance_fee ?? 0),
    delivery: Boolean(fee.delivery ?? true),
    extFees: Array.isArray(fee.extFees)
      ? (fee.extFees as any[]).map((e) => ({
          title: String(e.title ?? ""),
          amount: Number(e.amount ?? 0),
          type: String(e.type ?? ""),
        }))
      : [],
  };
}

export type GhtkSubmitOrderParams = {
  token: string;
  partnerCode?: string;
  order: {
    id: string;
    pickName: string;
    pickAddress: string;
    pickProvince: string;
    pickDistrict: string;
    pickWard?: string;
    pickTel: string;
    name: string;
    address: string;
    province: string;
    district: string;
    ward: string;
    hamlet?: string;
    tel: string;
    note?: string;
    pickMoney: number;
    value: number;
    isFreeShip?: 0 | 1;
    transport?: "road" | "fly";
    pickOption?: "cod" | "post";
  };
  products: Array<{
    name: string;
    weight: number;
    quantity: number;
    product_code?: string | number;
  }>;
};

export type GhtkSubmitOrderResult = {
  label: string;
  trackingId: number;
  fee: number;
  insuranceFee: number;
  estimatedPickTime?: string;
  estimatedDeliverTime?: string;
  statusId: number;
  partnerId: string;
};

export async function ghtkSubmitOrder(
  params: GhtkSubmitOrderParams,
): Promise<GhtkSubmitOrderResult> {
  const body = {
    products: params.products,
    order: {
      id: params.order.id,
      pick_name: params.order.pickName,
      pick_address: params.order.pickAddress,
      pick_province: params.order.pickProvince,
      pick_district: params.order.pickDistrict,
      pick_ward: params.order.pickWard,
      pick_tel: params.order.pickTel,
      name: params.order.name,
      address: params.order.address,
      province: params.order.province,
      district: params.order.district,
      ward: params.order.ward,
      hamlet: params.order.hamlet ?? "Khác",
      tel: params.order.tel,
      note: params.order.note ?? "",
      pick_money: params.order.pickMoney,
      value: params.order.value,
      is_freeship: params.order.isFreeShip ?? 0,
      transport: params.order.transport ?? "road",
      pick_option: params.order.pickOption ?? "cod",
    },
  };

  const data = await ghtkPost(
    "/services/shipment/order/?ver=1.5",
    params.token,
    body,
    params.partnerCode ?? env.ghtkPartnerCode,
  );

  const orderData = data.order as Record<string, unknown>;
  return {
    label: String(orderData.label ?? ""),
    trackingId: Number(orderData.tracking_id ?? 0),
    fee: Number(orderData.fee ?? 0),
    insuranceFee: Number(orderData.insurance_fee ?? 0),
    estimatedPickTime: orderData.estimated_pick_time ? String(orderData.estimated_pick_time) : undefined,
    estimatedDeliverTime: orderData.estimated_deliver_time ? String(orderData.estimated_deliver_time) : undefined,
    statusId: Number(orderData.status_id ?? 0),
    partnerId: String(orderData.partner_id ?? params.order.id),
  };
}

export type GhtkTrackingResult = {
  labelId: string;
  partnerId: string;
  status: string;
  statusText: string;
  created: string;
  modified: string;
  message: string;
  pickDate: string;
  deliverDate: string;
  customerFullname: string;
  customerTel: string;
  address: string;
  storageDay: number;
  shipMoney: number;
  insurance: number;
  value: number;
  weight: number;
  pickMoney: number;
  isFreeship: number;
};

export async function ghtkGetTracking(params: {
  token: string;
  partnerCode?: string;
  trackingOrder: string;
}): Promise<GhtkTrackingResult> {
  const headers: Record<string, string> = { Token: params.token };
  if (params.partnerCode) headers["X-Client-Source"] = params.partnerCode;

  const response = await fetch(
    `${getGhtkBase()}/services/shipment/v2/${encodeURIComponent(params.trackingOrder)}`,
    { headers },
  );

  let data: GhtkApiResponse;
  try {
    data = (await response.json()) as GhtkApiResponse;
  } catch {
    throw new ApiError(502, "Không đọc được phản hồi từ GHTK.", "GHTK_PARSE_ERROR");
  }

  if (!data.success) throwGhtkError(data);

  const o = data.order as Record<string, unknown>;
  return {
    labelId: String(o.label_id ?? ""),
    partnerId: String(o.partner_id ?? ""),
    status: String(o.status ?? ""),
    statusText: String(o.status_text ?? ""),
    created: String(o.created ?? ""),
    modified: String(o.modified ?? ""),
    message: String(o.message ?? ""),
    pickDate: String(o.pick_date ?? ""),
    deliverDate: String(o.deliver_date ?? ""),
    customerFullname: String(o.customer_fullname ?? ""),
    customerTel: String(o.customer_tel ?? ""),
    address: String(o.address ?? ""),
    storageDay: Number(o.storage_day ?? 0),
    shipMoney: Number(o.ship_money ?? 0),
    insurance: Number(o.insurance ?? 0),
    value: Number(o.value ?? 0),
    weight: Number(o.weight ?? 0),
    pickMoney: Number(o.pick_money ?? 0),
    isFreeship: Number(o.is_freeship ?? 0),
  };
}
