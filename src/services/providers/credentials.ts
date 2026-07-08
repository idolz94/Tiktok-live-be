import { eq } from "drizzle-orm";
import { db } from "../../lib/db.js";
import { shops, users } from "../../db/schema/index.js";
import { env } from "../../config/env.js";
import { ApiError } from "../../lib/api-error.js";

export type SpxCredentials = {
  userId: number;
  userSecret: string;
  environment: string;
};

export async function getSpxCredentials(shopId: string): Promise<SpxCredentials> {
  const rows = await db
    .select({
      spxUserId: users.spxUserId,
      spxUserSecret: users.spxUserSecret,
    })
    .from(shops)
    .innerJoin(users, eq(shops.ownerId, users.id))
    .where(eq(shops.id, shopId))
    .limit(1);

  const row = rows[0];
  const userId = row?.spxUserId ? Number(row.spxUserId) : undefined;
  const userSecret = row?.spxUserSecret ?? undefined;

  if (!userId || !userSecret) {
    throw new ApiError(400, "Shop chưa kết nối tài khoản SPX. Vào Cấu hình vận chuyển để kết nối.", "SPX_NOT_CONFIGURED");
  }

  const environment = env.spxApiBase?.includes("test") ? "sandbox" : "production";
  return { userId, userSecret, environment };
}
