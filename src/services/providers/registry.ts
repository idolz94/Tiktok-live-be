import type {
  ShippingProviderAdapter,
  ShippingProviderCode,
} from "./types.js";
import { createManualAdapter } from "./manual.adapter.js";
import { createSpxAdapter } from "./spx.adapter.js";

const adapters: Record<ShippingProviderCode, ShippingProviderAdapter> = {
  manual: createManualAdapter(),
  spx: createSpxAdapter(),
};

export function normalizeShippingProviderCode(value: string | null | undefined): ShippingProviderCode {
  const code = String(value || "").trim().toLowerCase();
  if (code === "spx") return "spx";
  return "manual";
}

export function getShippingProviderAdapter(providerCode: string | null | undefined): ShippingProviderAdapter {
  return adapters[normalizeShippingProviderCode(providerCode)];
}
