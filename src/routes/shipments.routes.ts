import { Router } from "express";
import { and, eq } from "drizzle-orm";
import { asyncHandler } from "../lib/async-handler.js";
import { ok } from "../lib/response.js";
import { requireAuth } from "../middlewares/auth.js";
import { requireShopId } from "../services/account.service.js";
import { db } from "../lib/db.js";
import { orderShipments, orders } from "../db/schema/index.js";

const router = Router();

router.use(requireAuth);

router.get(
  "/",
  asyncHandler(async (request, response) => {
    const shopId = await requireShopId(request);
    const limit = request.query.limit ? Math.min(Number(request.query.limit), 200) : 100;
    const offset = request.query.offset ? Number(request.query.offset) : 0;

    const shipments = await db
      .select({
        id: orderShipments.id,
        orderId: orderShipments.orderId,
        orderCode: orders.orderCode,
        providerCode: orderShipments.providerCode,
        trackingLabel: orderShipments.trackingLabel,
        trackingCode: orderShipments.trackingCode,
        status: orderShipments.status,
        fee: orderShipments.fee,
        createdAt: orderShipments.createdAt,
      })
      .from(orderShipments)
      .innerJoin(orders, eq(orders.id, orderShipments.orderId))
      .where(and(eq(orderShipments.shopId, shopId), eq(orders.shopId, shopId)))
      .orderBy(orderShipments.createdAt)
      .limit(limit)
      .offset(offset);

    return ok(response, { shipments });
  }),
);

export default router;
