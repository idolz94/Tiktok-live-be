import { eq, and } from "drizzle-orm";
import { db } from "../lib/db.js";
import { shopSettings } from "../db/schema/index.js";

export type ProductDefaults = {
  code: string;
  color: string;
  size: string;
  price: number;
};

const PRODUCT_DEFAULTS_KEY = "product_defaults";

const defaultProductDefaults: ProductDefaults = {
  code: "",
  color: "",
  size: "",
  price: 0,
};

export async function getProductDefaults(shopId: string): Promise<ProductDefaults> {
  const rows = await db
    .select()
    .from(shopSettings)
    .where(and(eq(shopSettings.shopId, shopId), eq(shopSettings.key, PRODUCT_DEFAULTS_KEY)))
    .limit(1);

  const row = rows[0];
  if (!row?.value) return defaultProductDefaults;

  const val = row.value as Record<string, unknown>;
  return {
    code: typeof val.code === "string" ? val.code : "",
    color: typeof val.color === "string" ? val.color : "",
    size: typeof val.size === "string" ? val.size : "",
    price: typeof val.price === "number" ? val.price : 0,
  };
}

export async function upsertProductDefaults(
  shopId: string,
  payload: Partial<ProductDefaults>,
): Promise<ProductDefaults> {
  const current = await getProductDefaults(shopId);
  const next: ProductDefaults = {
    code: payload.code !== undefined ? payload.code : current.code,
    color: payload.color !== undefined ? payload.color : current.color,
    size: payload.size !== undefined ? payload.size : current.size,
    price: payload.price !== undefined ? payload.price : current.price,
  };

  const existing = await db
    .select({ id: shopSettings.id })
    .from(shopSettings)
    .where(and(eq(shopSettings.shopId, shopId), eq(shopSettings.key, PRODUCT_DEFAULTS_KEY)))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(shopSettings)
      .set({ value: next, updatedAt: new Date() })
      .where(and(eq(shopSettings.shopId, shopId), eq(shopSettings.key, PRODUCT_DEFAULTS_KEY)));
  } else {
    await db.insert(shopSettings).values({
      shopId,
      key: PRODUCT_DEFAULTS_KEY,
      value: next,
    });
  }

  return next;
}

export type PrinterSettings = {
  printerIp: string;
  printerPort: number;
  printerName: string;
};

const PRINTER_SETTINGS_KEY = "printer_settings";

const defaultPrinterSettings: PrinterSettings = {
  printerIp: "",
  printerPort: 9100,
  printerName: "",
};

export async function getPrinterSettings(shopId: string): Promise<PrinterSettings> {
  const rows = await db
    .select()
    .from(shopSettings)
    .where(and(eq(shopSettings.shopId, shopId), eq(shopSettings.key, PRINTER_SETTINGS_KEY)))
    .limit(1);

  const row = rows[0];
  if (!row?.value) return defaultPrinterSettings;

  const val = row.value as Record<string, unknown>;
  return {
    printerIp: typeof val.printerIp === "string" ? val.printerIp : "",
    printerPort: typeof val.printerPort === "number" ? val.printerPort : 9100,
    printerName: typeof val.printerName === "string" ? val.printerName : "",
  };
}

export async function upsertPrinterSettings(
  shopId: string,
  payload: Partial<PrinterSettings>,
): Promise<PrinterSettings> {
  const current = await getPrinterSettings(shopId);
  const next: PrinterSettings = {
    printerIp: payload.printerIp !== undefined ? payload.printerIp : current.printerIp,
    printerPort: payload.printerPort !== undefined ? payload.printerPort : current.printerPort,
    printerName: payload.printerName !== undefined ? payload.printerName : current.printerName,
  };

  const existing = await db
    .select({ id: shopSettings.id })
    .from(shopSettings)
    .where(and(eq(shopSettings.shopId, shopId), eq(shopSettings.key, PRINTER_SETTINGS_KEY)))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(shopSettings)
      .set({ value: next, updatedAt: new Date() })
      .where(and(eq(shopSettings.shopId, shopId), eq(shopSettings.key, PRINTER_SETTINGS_KEY)));
  } else {
    await db.insert(shopSettings).values({
      shopId,
      key: PRINTER_SETTINGS_KEY,
      value: next,
    });
  }

  return next;
}

export type InvoiceContent = {
  companyName: string;
  companyAddress: string;
  recordNumb: number;
};

const INVOICE_CONTENT_KEY = "invoice_content";

const defaultInvoiceContent: InvoiceContent = {
  companyName: "",
  companyAddress: "",
  recordNumb: 0,
};

export async function getInvoiceContent(shopId: string): Promise<InvoiceContent> {
  const rows = await db
    .select()
    .from(shopSettings)
    .where(and(eq(shopSettings.shopId, shopId), eq(shopSettings.key, INVOICE_CONTENT_KEY)))
    .limit(1);

  const row = rows[0];
  if (!row?.value) return defaultInvoiceContent;

  const val = row.value as Record<string, unknown>;
  return {
    companyName: typeof val.companyName === "string" ? val.companyName : "",
    companyAddress: typeof val.companyAddress === "string" ? val.companyAddress : "",
    recordNumb: typeof val.recordNumb === "number" ? val.recordNumb : 0,
  };
}

export async function upsertInvoiceContent(
  shopId: string,
  payload: Partial<InvoiceContent>,
): Promise<InvoiceContent> {
  const current = await getInvoiceContent(shopId);
  const next: InvoiceContent = {
    companyName: payload.companyName !== undefined ? payload.companyName : current.companyName,
    companyAddress: payload.companyAddress !== undefined ? payload.companyAddress : current.companyAddress,
    recordNumb: payload.recordNumb !== undefined ? payload.recordNumb : current.recordNumb,
  };

  const existing = await db
    .select({ id: shopSettings.id })
    .from(shopSettings)
    .where(and(eq(shopSettings.shopId, shopId), eq(shopSettings.key, INVOICE_CONTENT_KEY)))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(shopSettings)
      .set({ value: next, updatedAt: new Date() })
      .where(and(eq(shopSettings.shopId, shopId), eq(shopSettings.key, INVOICE_CONTENT_KEY)));
  } else {
    await db.insert(shopSettings).values({
      shopId,
      key: INVOICE_CONTENT_KEY,
      value: next,
    });
  }

  return next;
}
