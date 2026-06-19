import { and, eq } from "drizzle-orm";
import { db } from "../../lib/db.js";
import { shopSettings } from "../../db/schema/index.js";
import { env } from "../../config/env.js";

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
