import type {
  ShippingProviderAdapter,
  ShippingProviderCode,
} from "./types.js";
import { createGhtkAdapter } from "./ghtk.adapter.js";
import { createManualAdapter } from "./manual.adapter.js";
const adapters: Record<ShippingProviderCode, ShippingProviderAdapter> = {
  ghtk: createGhtkAdapter(),
  manual: createManualAdapter(),
};

export function normalizeShippingProviderCode(value: string | null | undefined): ShippingProviderCode {
  const code = String(value || "").trim().toLowerCase();
  if (code === "manual") return "manual";
  return "ghtk";
}

export function getShippingProviderAdapter(providerCode: string | null | undefined): ShippingProviderAdapter {
  return adapters[normalizeShippingProviderCode(providerCode)];
}
