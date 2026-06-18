import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler.js";
import { mutateOk, ok } from "../lib/response.js";
import { requireAuth } from "../middlewares/auth.js";
import { requireShopId } from "../services/account.service.js";
import { getCustomerById, updateCustomerProfile } from "../services/customer.service.js";

const router = Router();

const updateCustomerSchema = z.object({
  customerType: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  referenceInfo: z.string().optional().nullable(),
  shippingAddress: z.string().optional().nullable(),
});

router.use(requireAuth);

router.get(
  "/:customerId",
  asyncHandler(async (request, response) => {
    const shopId = await requireShopId(request);
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
    const shopId = await requireShopId(request);
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
