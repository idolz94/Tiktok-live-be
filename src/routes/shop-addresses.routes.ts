import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler.js";
import { ok, mutateOk, mutateCreated } from "../lib/response.js";
import { requireAuth } from "../middlewares/auth.js";
import { requireUsableAccountContext } from "../services/account.service.js";
import {
  listShopAddresses,
  createShopAddress,
  updateShopAddress,
  deleteShopAddress,
} from "../services/shop-addresses.service.js";

const router = Router();

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
    const ctx = await requireUsableAccountContext(request);
    const addresses = await listShopAddresses(ctx.shop.id);
    return ok(response, { addresses });
  }),
);

router.post(
  "/",
  asyncHandler(async (request, response) => {
    const ctx = await requireUsableAccountContext(request);
    const body = addressBodySchema.parse(request.body || {});
    const address = await createShopAddress(ctx.shop.id, body);
    return mutateCreated(response, "Thêm địa chỉ thành công.", { address });
  }),
);

router.patch(
  "/:addressId",
  asyncHandler(async (request, response) => {
    const ctx = await requireUsableAccountContext(request);
    const body = addressBodySchema.parse(request.body || {});
    const address = await updateShopAddress(ctx.shop.id, String(request.params.addressId), body);
    return mutateOk(response, "Cập nhật địa chỉ thành công.", { address });
  }),
);

router.delete(
  "/:addressId",
  asyncHandler(async (request, response) => {
    const ctx = await requireUsableAccountContext(request);
    await deleteShopAddress(ctx.shop.id, String(request.params.addressId));
    return mutateOk(response, "Đã xoá địa chỉ.");
  }),
);

export default router;
