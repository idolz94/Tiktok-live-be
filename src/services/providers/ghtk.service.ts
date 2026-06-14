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
