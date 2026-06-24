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

  const userId = row
    ? Number((row.extraConfig as Record<string, unknown> | null)?.spx_user_id)
    : Number(env.spxUserId);
  const userSecret = row
    ? String((row.extraConfig as Record<string, unknown> | null)?.spx_user_secret ?? "")
    : (env.spxUserSecret ?? "");
  const environment = row?.environment ?? (env.spxApiBase?.includes("test") ? "sandbox" : "production");

  if (!userId || !userSecret) {
    throw new ApiError(400, "Shop chưa cấu hình SPX hoặc SPX chưa được bật.", "SPX_NOT_CONFIGURED");
  }

  return { userId, userSecret, environment };
}

