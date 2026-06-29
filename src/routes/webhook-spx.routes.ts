import { Router } from "express";
import express from "express";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../lib/db.js";
import { orderShipments, orders } from "../db/schema/index.js";
import { broadcastSseToShop } from "../lib/sse-hub.js";
import { env } from "../config/env.js";
import { mapSpxStatus } from "../services/providers/spx.adapter.js";

const router = Router();

router.use(express.json());

function verifySpxSign(body: unknown, checkSign: string): boolean {
  const payload = JSON.stringify(body);
  const timestamp = checkSign.split("_")[1] ?? "";
  const randomNum = checkSign.split("_")[2] ?? "";
  const raw = `${env.spxAppId}_${timestamp}_${randomNum}_${payload}`;
  const expected = crypto.createHmac("sha256", env.spxAppSecret).update(raw).digest("hex");
  const expectedSign = `${env.spxAppId}_${timestamp}_${randomNum}_${expected}`;
  return crypto.timingSafeEqual(Buffer.from(expectedSign), Buffer.from(checkSign));
}

router.post("/", async (req, res) => {
  try {
    const checkSign = String(req.headers["check-sign"] ?? "");
    if (!checkSign) {
      res.status(200).json({ ok: false, message: "Missing check-sign" });
      return;
    }

    try {
      if (!verifySpxSign(req.body, checkSign)) {
        res.status(200).json({ ok: false, message: "Invalid signature" });
        return;
      }
    } catch {
      res.status(200).json({ ok: false, message: "Invalid signature" });
      return;
    }

    const { tracking_no, status_code, tracking_link } = req.body as Record<string, unknown>;
    if (!tracking_no || status_code == null) {
      res.status(200).json({ ok: false, message: "Missing fields" });
      return;
    }

    const statusCodeNum = Number(status_code);
    const shippingStatus = mapSpxStatus(statusCodeNum);

    const [shipment] = await db
      .select()
      .from(orderShipments)
      .where(eq(orderShipments.spxTrackingNo, String(tracking_no)))
      .limit(1);

    if (!shipment) {
      res.status(200).json({ ok: false, message: "Shipment not found" });
      return;
    }

    const now = new Date();
    await db
      .update(orderShipments)
      .set({
        status: shippingStatus,
        statusCode: String(statusCodeNum),
        statusRaw: String(statusCodeNum),
        ...(tracking_link ? { trackingLink: String(tracking_link) } : {}),
        updatedAt: now,
      })
      .where(eq(orderShipments.id, shipment.id));

    await db
      .update(orders)
      .set({ shippingStatus, updatedAt: now })
      .where(eq(orders.id, shipment.orderId));

    broadcastSseToShop(shipment.shopId, "ORDER_SHIPPING_UPDATED", {
      orderId: shipment.orderId,
      shipmentId: shipment.id,
      trackingNo: tracking_no,
      trackingLink: tracking_link ?? null,
      statusCode: statusCodeNum,
      shippingStatus,
    });

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("[webhook-spx] error:", err);
    res.status(200).json({ ok: false, message: "Internal error" });
  }
});

export default router;
