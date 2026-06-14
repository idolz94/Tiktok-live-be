import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler.js";
import { ok, mutateOk, mutateCreated } from "../lib/response.js";
import { requireAuth } from "../middlewares/auth.js";
import { requireShopId } from "../services/account.service.js";
import {
  listCustomerAddresses,
  createCustomerAddress,
  updateCustomerAddress,
  deleteCustomerAddress,
} from "../services/customer-addresses.service.js";

const router = Router({ mergeParams: true });

const addressBodySchema = z.object({
  label: z.string().optional().nullable(),
  name: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  province: z.string().optional().nullable(),
  district: z.string().optional().nullable(),
  ward: z.string().optional().nullable(),
  isDefault: z.boolean().optional(),
});

router.use(requireAuth);

router.get(
  "/",
  asyncHandler(async (request, response) => {
    const shopId = await requireShopId(request);
    const addresses = await listCustomerAddresses(shopId, String(request.params.customerId));
    return ok(response, { addresses });
  }),
);

router.post(
  "/",
  asyncHandler(async (request, response) => {
    const shopId = await requireShopId(request);
    const body = addressBodySchema.parse(request.body || {});
    const address = await createCustomerAddress(shopId, String(request.params.customerId), body);
    return mutateCreated(response, "Thêm địa chỉ thành công.", { address });
  }),
);

router.patch(
  "/:addressId",
  asyncHandler(async (request, response) => {
    const shopId = await requireShopId(request);
    const body = addressBodySchema.parse(request.body || {});
    const address = await updateCustomerAddress(
      shopId,
      String(request.params.customerId),
      String(request.params.addressId),
      body,
    );
    return mutateOk(response, "Cập nhật địa chỉ thành công.", { address });
  }),
);

router.delete(
  "/:addressId",
  asyncHandler(async (request, response) => {
    const shopId = await requireShopId(request);
    await deleteCustomerAddress(shopId, String(request.params.customerId), String(request.params.addressId));
    return mutateOk(response, "Đã xoá địa chỉ.");
  }),
);

export default router;
