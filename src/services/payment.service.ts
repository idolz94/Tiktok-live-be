import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "../lib/supabase.js";
import { activateLicenseFromPayment } from "./license.service.js";

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
  const now = new Date().toISOString();
  const paymentCode = `PAY-${Date.now()}-${randomUUID().slice(0, 8).toUpperCase()}`;

  const { data, error } = await supabaseAdmin
    .from("payments")
    .insert({
      shop_id: shopId,
      provider: "manual",
      payment_code: paymentCode,
      plan_code: planCode,
      months,
      amount,
      currency: "VND",
      status: "pending",
      checkout_url: process.env.PAYMENT_RETURN_URL || "",
      raw_payload: {},
      created_at: now,
      updated_at: now,
    })
    .select("*")
    .single();

  if (error) throw new Error(error.message);

  return {
    payment: data,
    checkoutUrl: data.checkout_url,
    message: "Payment provider đang để manual. Sau khi nhận tiền, gọi endpoint confirm để active license.",
  };
}

export async function confirmManualPayment({ paymentId }: { paymentId: string }) {
  const { data: payment, error: findError } = await supabaseAdmin
    .from("payments")
    .select("*")
    .eq("id", paymentId)
    .maybeSingle();

  if (findError) throw new Error(findError.message);
  if (!payment) throw new Error("Không tìm thấy payment.");

  const now = new Date().toISOString();
  const license = await activateLicenseFromPayment({
    shopId: payment.shop_id,
    planCode: payment.plan_code,
    months: Number(payment.months || 1),
    price: Number(payment.amount || 0),
    paymentId: payment.id,
  });

  const { data: updatedPayment, error: updateError } = await supabaseAdmin
    .from("payments")
    .update({ status: "paid", paid_at: now, updated_at: now })
    .eq("id", paymentId)
    .select("*")
    .single();

  if (updateError) throw new Error(updateError.message);

  return { payment: updatedPayment, license };
}
