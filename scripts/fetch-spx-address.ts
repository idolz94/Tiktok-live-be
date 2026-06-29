/**
 * One-shot script: fetch SPX address file download URL then download the xlsx.
 * Usage: npx tsx scripts/fetch-spx-address.ts
 */
import { createHmac } from "crypto";
import { writeFileSync } from "fs";
import { join } from "path";
import dotenv from "dotenv";

dotenv.config();

const appId = process.env.SPX_APP_ID;
const appSecret = process.env.SPX_APP_SECRET;
const base = process.env.SPX_API_BASE ?? "https://test-stable.spx.vn";

if (!appId || !appSecret) {
  console.error("SPX_APP_ID and SPX_APP_SECRET must be set in .env");
  process.exit(1);
}

async function main() {
  const payload = "{}";
  const timestamp = Math.floor(Date.now() / 1000);
  const randomNum = Math.floor(Math.random() * 1_000_000);
  const checkSign = createHmac("sha256", appSecret!)
    .update(`${appId}_${timestamp}_${randomNum}_${payload}`)
    .digest("hex");

  const res = await fetch(`${base}/open/api/address/get_address_download_url`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "app-id": appId!,
      "check-sign": checkSign,
      "timestamp": String(timestamp),
      "random-num": String(randomNum),
    },
    body: payload,
  });

  const json = (await res.json()) as { ret_code: number; message: string; data?: { address_download_url: string } };

  if (json.ret_code !== 0) {
    console.error("SPX error:", json.message);
    process.exit(1);
  }

  const url = json.data!.address_download_url;
  console.log("Download URL:", url);

  const fileRes = await fetch(url);
  if (!fileRes.ok) {
    console.error("Failed to download file:", fileRes.status, fileRes.statusText);
    process.exit(1);
  }

  const buffer = Buffer.from(await fileRes.arrayBuffer());
  const outPath = join(process.cwd(), "spx-address.xlsx");
  writeFileSync(outPath, buffer);
  console.log("Saved to:", outPath);
}

main().catch((err) => { console.error(err); process.exit(1); });
