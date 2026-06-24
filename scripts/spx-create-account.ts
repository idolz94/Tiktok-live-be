/**
 * One-shot script: tạo SPX merchant account và lưu credentials vào DB.
 *
 * Usage:
 *   npx tsx scripts/spx-create-account.ts --shop-id <uuid> --phone <phone> [--email <email>] [--env sandbox|production]
 */

import { eq, and } from "drizzle-orm";
import { db } from "../src/lib/db.js";
import { shopShippingProviders } from "../src/db/schema/index.js";
import { spxCreateAccount } from "../src/services/providers/spx.service.js";

const args = process.argv.slice(2);
const get = (flag: string) => {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : undefined;
};

const shopId = get("--shop-id");
const phone = get("--phone");
const email = get("--email");
const environment = get("--env") ?? "sandbox";

if (!shopId || !phone) {
  console.error("Usage: npx tsx scripts/spx-create-account.ts --shop-id <uuid> --phone <phone> [--email <email>] [--env sandbox|production]");
  process.exit(1);
}

console.log(`Creating SPX account for shop ${shopId}, phone=${phone}, env=${environment}...`);

const { userId, userSecret } = await spxCreateAccount({ phone, email });
console.log(`SPX account created: user_id=${userId}`);

const existing = await db
  .select({ id: shopShippingProviders.shopId })
  .from(shopShippingProviders)
  .where(and(eq(shopShippingProviders.shopId, shopId), eq(shopShippingProviders.providerCode, "spx")))
  .limit(1);

if (existing.length > 0) {
  await db
    .update(shopShippingProviders)
    .set({ isEnabled: true, environment, extraConfig: { spx_user_id: userId, spx_user_secret: userSecret } })
    .where(and(eq(shopShippingProviders.shopId, shopId), eq(shopShippingProviders.providerCode, "spx")));
  console.log("Updated existing row in shop_shipping_providers.");
} else {
  await db.insert(shopShippingProviders).values({
    shopId,
    providerCode: "spx",
    isEnabled: true,
    environment,
    extraConfig: { spx_user_id: userId, spx_user_secret: userSecret },
  });
  console.log("Inserted new row in shop_shipping_providers.");
}

console.log("Done.");
process.exit(0);
