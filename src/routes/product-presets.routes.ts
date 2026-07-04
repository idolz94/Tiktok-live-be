import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler.js";
import { mutateCreated, mutateOk, ok } from "../lib/response.js";
import { requireAuth } from "../middlewares/auth.js";
import { requireUsableAccountContext } from "../services/account.service.js";
import {
  listProductPresets,
  createProductPreset,
  updateProductPreset,
  deleteProductPreset,
} from "../services/product-presets.service.js";

const router = Router();

const XSS_PATTERN = /<[^>]*>|javascript:|on\w+\s*=/i;
const safeText = (label: string) =>
  z.string().refine((v) => !XSS_PATTERN.test(v), { message: `${label} không được chứa nội dung không hợp lệ` });
const safeTextMin1 = (label: string) =>
  z.string().min(1, `${label} không được trống`).refine((v) => !XSS_PATTERN.test(v), { message: `${label} không được chứa nội dung không hợp lệ` });

const createSchema = z.object({
  code: safeTextMin1("Mã SP"),
  name: safeText("Tên sản phẩm").nullish(),
  color: safeText("Màu sắc").nullish(),
  price: z.number().min(0),
});

const updateSchema = z.object({
  code: safeTextMin1("Mã SP").optional(),
  name: safeText("Tên sản phẩm").nullish(),
  color: safeText("Màu sắc").nullish(),
  price: z.number().min(0).optional(),
});

router.use(requireAuth);

router.get(
  "/",
  asyncHandler(async (request, response) => {
    const context = await requireUsableAccountContext(request);
    const presets = await listProductPresets(context.shop.id);
    return ok(response, { presets });
  }),
);

router.post(
  "/",
  asyncHandler(async (request, response) => {
    const context = await requireUsableAccountContext(request);
    const body = createSchema.parse(request.body || {});
    const preset = await createProductPreset(context.shop.id, body);
    return mutateCreated(response, "Tạo preset thành công.", { preset });
  }),
);

router.patch(
  "/:presetId",
  asyncHandler(async (request, response) => {
    const context = await requireUsableAccountContext(request);
    const body = updateSchema.parse(request.body || {});
    const preset = await updateProductPreset(context.shop.id, String(request.params.presetId), body);
    return mutateOk(response, "Cập nhật preset thành công.", { preset });
  }),
);

router.delete(
  "/:presetId",
  asyncHandler(async (request, response) => {
    const context = await requireUsableAccountContext(request);
    await deleteProductPreset(context.shop.id, String(request.params.presetId));
    return mutateOk(response, "Xóa preset thành công.", null);
  }),
);

export default router;
