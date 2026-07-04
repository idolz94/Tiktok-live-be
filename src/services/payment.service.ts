import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../lib/db.js";
import { payments } from "../db/schema/index.js";
import { activateLicenseFromPayment } from "./license.service.js";
import { env } from "../config/env.js";
import { badRequest, forbidden, notFound } from "../lib/api-error.js";

export async function createManualCheckout({
  shopId,
  planCode,
  months = 1,
  amount = 0,
}: {
  shopId: string;
  planCode: string;
  months?: number;
  amount?: number;
}) {
  const paymentCode = `PAY-${Date.now()}-${randomUUID().slice(0, 8).toUpperCase()}`;

  const [payment] = await db
    .insert(payments)
    .values({
      shopId,
      provider: "manual",
      paymentCode,
      planCode,
      months,
      amount,
      currency: "VND",
      status: "pending",
      checkoutUrl: env.paymentReturnUrl,
      rawPayload: {},
    })
    .returning();

  return {
    payment,
    checkoutUrl: payment.checkoutUrl,
    message: "Payment provider đang để manual. Sau khi nhận tiền, gọi endpoint confirm để active license.",
  };
}

export async function confirmManualPayment({ paymentId, shopId }: { paymentId: string; shopId: string }) {
  const rows = await db
    .select()
    .from(payments)
    .where(eq(payments.id, paymentId))
    .limit(1);

  const payment = rows[0];
  if (!payment) throw notFound("Không tìm thấy payment.");
  if (payment.shopId !== shopId) throw forbidden("Không có quyền xác nhận payment này.");
  if (payment.status !== "pending") throw badRequest("Payment đã được xử lý trước đó.");

  const license = await activateLicenseFromPayment({
    shopId: payment.shopId,
    planCode: payment.planCode ?? "basic",
    months: Number(payment.months || 1),
    price: Number(payment.amount || 0),
    paymentId: payment.id,
  });

  const [updatedPayment] = await db
    .update(payments)
    .set({ status: "paid", paidAt: new Date(), updatedAt: new Date() })
    .where(eq(payments.id, paymentId))
    .returning();

  return { payment: updatedPayment, license };
}
