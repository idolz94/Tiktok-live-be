import { Router } from "express";
import express from "express";
import { eq } from "drizzle-orm";
import { db } from "../lib/db.js";
import { orderShipments, orders } from "../db/schema/index.js";
import { broadcastSseToShop } from "../lib/sse-hub.js";

const router = Router();

router.use(express.urlencoded({ extended: false }));

function mapStatusIdToShippingStatus(statusId: number): string {
  if (statusId === -1) return "cancelled";
  if (statusId === 5 || statusId === 6) return "delivered";
  if (statusId === 9 || statusId === 20 || statusId === 21) return "returned";
  return "submitted";
}

router.post("/", async (req, res) => {
  try {
    const {
      label_id,
      partner_id,
      status_id,
      fee,
      pick_money,
      action_time,
      reason_code,
      reason,
    } = req.body as Record<string, string>;

    if (!label_id || status_id == null) {
      res.status(200).json({ ok: false, message: "Missing required fields" });
      return;
    }

    const statusIdNum = Number(status_id);
    const feeNum = fee != null ? Number(fee) : undefined;
    const pickMoneyNum = pick_money != null ? Number(pick_money) : undefined;

    const [shipment] = await db
      .select()
      .from(orderShipments)
      .where(eq(orderShipments.trackingLabel, label_id))
      .limit(1);

    if (!shipment) {
      res.status(200).json({ ok: false, message: "Shipment not found" });
      return;
    }

    const shippingStatus = mapStatusIdToShippingStatus(statusIdNum);

    await db
      .update(orderShipments)
      .set({
        statusCode: String(statusIdNum),
        ...(feeNum != null ? { fee: feeNum } : {}),
        updatedAt: new Date(),
      })
      .where(eq(orderShipments.id, shipment.id));

    await db
      .update(orders)
      .set({ shippingStatus, updatedAt: new Date() })
      .where(eq(orders.id, shipment.orderId));

    broadcastSseToShop(shipment.shopId, "ORDER_SHIPPING_UPDATED", {
      orderId: shipment.orderId,
      shipmentId: shipment.id,
      labelId: label_id,
      partnerId: partner_id ?? null,
      statusId: statusIdNum,
      shippingStatus,
      fee: feeNum ?? null,
      pickMoney: pickMoneyNum ?? null,
      actionTime: action_time ?? null,
      reasonCode: reason_code ?? null,
      reason: reason ?? null,
    });

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("[webhook-ghtk] error:", err);
    res.status(200).json({ ok: false, message: "Internal error" });
  }
});

export default router;
