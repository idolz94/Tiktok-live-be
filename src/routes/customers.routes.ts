import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler.js";
import { mutateOk, ok } from "../lib/response.js";
import { requireAuth } from "../middlewares/auth.js";
import { requireUsableAccountContext } from "../services/account.service.js";
import { getCustomerById, listCustomerOrders, listCustomers, updateCustomerProfile } from "../services/customer.service.js";

const router = Router();

const updateCustomerSchema = z.object({
  customerType: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  referenceInfo: z.string().optional().nullable(),
  shippingAddress: z.string().optional().nullable(),
});

router.use(requireAuth);

router.get(
  "/",
  asyncHandler(async (request, response) => {
    const ctx = await requireUsableAccountContext(request);
    const shopId = ctx.shop.id;
    const limit = request.query.limit ? Math.min(Number(request.query.limit), 200) : 100;
    const offset = request.query.offset ? Number(request.query.offset) : 0;
    const customers = await listCustomers(shopId, limit, offset);
    return ok(response, { customers });
  }),
);

router.get(
  "/:customerId/orders",
  asyncHandler(async (request, response) => {
    const ctx = await requireUsableAccountContext(request);
    const shopId = ctx.shop.id;
    const limit = request.query.limit ? Math.min(Number(request.query.limit), 200) : 200;
    const offset = request.query.offset ? Number(request.query.offset) : 0;
    const orders = await listCustomerOrders(shopId, String(request.params.customerId), limit, offset);
    return ok(response, { orders });
  }),
);

router.get(
  "/:customerId",
  asyncHandler(async (request, response) => {
    const ctx = await requireUsableAccountContext(request);
    const shopId = ctx.shop.id;
    const customer = await getCustomerById({
      shopId,
      customerId: String(request.params.customerId),
    });
    return ok(response, { customer });
  }),
);

router.patch(
  "/:customerId",
  asyncHandler(async (request, response) => {
    const ctx = await requireUsableAccountContext(request);
    const shopId = ctx.shop.id;
    const body = updateCustomerSchema.parse(request.body || {});
    const customer = await updateCustomerProfile({
      shopId,
      customerId: String(request.params.customerId),
      customerType: body.customerType,
      phone: body.phone,
      referenceInfo: body.referenceInfo,
      shippingAddress: body.shippingAddress,
    });

    return mutateOk(response, "Cập nhật khách hàng thành công.", { customer });
  }),
);

export default router;
