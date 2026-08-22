import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler.js";
import { ok, mutateOk } from "../lib/response.js";
import { requireAuth } from "../middlewares/auth.js";
import { requireUsableAccountContext } from "../services/account.service.js";
import {
  getInvoiceContent,
  getPrinterSettings,
  getProductDefaults,
  upsertInvoiceContent,
  upsertPrinterSettings,
  upsertProductDefaults,
} from "../services/shop-settings.service.js";

const router = Router();

const patchProductDefaultsSchema = z.object({
  code: z.string().optional(),
  color: z.string().optional(),
  size: z.string().optional(),
  price: z.number().min(0).optional(),
});

// GET /api/me/shop-settings/product-defaults
router.get(
  "/product-defaults",
  requireAuth,
  asyncHandler(async (request, response) => {
    const ctx = await requireUsableAccountContext(request);
    const data = await getProductDefaults(ctx.shop.id);
    return ok(response, data);
  }),
);

// PATCH /api/me/shop-settings/product-defaults
router.patch(
  "/product-defaults",
  requireAuth,
  asyncHandler(async (request, response) => {
    const ctx = await requireUsableAccountContext(request);
    const body = patchProductDefaultsSchema.parse(request.body || {});
    const data = await upsertProductDefaults(ctx.shop.id, body);
    return mutateOk(response, "Lưu cài đặt thành công.", data);
  }),
);

const patchPrinterSettingsSchema = z.object({
  printerIp: z.string().optional(),
  printerPort: z.number().int().min(1).max(65535).optional(),
  printerName: z.string().optional(),
});

// GET /api/me/shop-settings/printer
router.get(
  "/printer",
  requireAuth,
  asyncHandler(async (request, response) => {
    const ctx = await requireUsableAccountContext(request);
    const data = await getPrinterSettings(ctx.shop.id);
    return ok(response, data);
  }),
);

// PATCH /api/me/shop-settings/printer
router.patch(
  "/printer",
  requireAuth,
  asyncHandler(async (request, response) => {
    const ctx = await requireUsableAccountContext(request);
    const body = patchPrinterSettingsSchema.parse(request.body || {});
    const data = await upsertPrinterSettings(ctx.shop.id, body);
    return mutateOk(response, "Lưu cài đặt máy in thành công.", data);
  }),
);

const patchInvoiceContentSchema = z.object({
  companyName: z.string().optional(),
  companyAddress: z.string().optional(),
  recordNumb: z.number().int().min(0).optional(),
});

// GET /api/me/shop-settings/invoice-content
router.get(
  "/invoice-content",
  requireAuth,
  asyncHandler(async (request, response) => {
    const ctx = await requireUsableAccountContext(request);
    const data = await getInvoiceContent(ctx.shop.id);
    return ok(response, data);
  }),
);

// PATCH /api/me/shop-settings/invoice-content
router.patch(
  "/invoice-content",
  requireAuth,
  asyncHandler(async (request, response) => {
    const ctx = await requireUsableAccountContext(request);
    const body = patchInvoiceContentSchema.parse(request.body || {});
    const data = await upsertInvoiceContent(ctx.shop.id, body);
    return mutateOk(response, "Lưu nội dung hóa đơn thành công.", data);
  }),
);

export default router;
