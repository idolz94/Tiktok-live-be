import { and, eq } from "drizzle-orm";
import { db } from "../../lib/db.js";
import { shopSettings, shopShippingProviders } from "../../db/schema/index.js";
import { env } from "../../config/env.js";
import { ApiError } from "../../lib/api-error.js";

const GHTK_TOKEN_KEY = "ghtk_token";

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

  return env.ghtkApiToken || "";
}

export async function getProviderToken(shopId: string, providerCode: string): Promise<string> {
  if (providerCode === "ghtk") return getGhtkToken(shopId);
  return "";
}

export type SpxCredentials = {
  userId: number;
  userSecret: string;
  environment: string;
};

export async function getSpxCredentials(shopId: string): Promise<SpxCredentials> {
  const rows = await db
    .select()
    .from(shopShippingProviders)
    .where(
      and(
        eq(shopShippingProviders.shopId, shopId),
        eq(shopShippingProviders.providerCode, "spx"),
        eq(shopShippingProviders.isEnabled, true),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) throw new ApiError(400, "Shop chưa cấu hình SPX hoặc SPX chưa được bật.", "SPX_NOT_CONFIGURED");

  const cfg = row.extraConfig as Record<string, unknown> | null;
  const userId = Number(cfg?.spx_user_id);
  const userSecret = typeof cfg?.spx_user_secret === "string" ? cfg.spx_user_secret : "";

  if (!userId || !userSecret) {
    throw new ApiError(400, "Thông tin SPX của shop không đầy đủ, vui lòng kiểm tra cài đặt.", "SPX_CREDS_INCOMPLETE");
  }

  return { userId, userSecret, environment: row.environment ?? "production" };
}

