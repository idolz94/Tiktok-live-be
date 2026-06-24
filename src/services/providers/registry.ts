import type {
  ShippingProviderAdapter,
  ShippingProviderCode,
} from "./types.js";
import { createGhtkAdapter } from "./ghtk.adapter.js";
import { createManualAdapter } from "./manual.adapter.js";
import { createSpxAdapter } from "./spx.adapter.js";

const adapters: Record<ShippingProviderCode, ShippingProviderAdapter> = {
  ghtk: createGhtkAdapter(),
  manual: createManualAdapter(),
  spx: createSpxAdapter(),
};

export function normalizeShippingProviderCode(value: string | null | undefined): ShippingProviderCode {
  const code = String(value || "").trim().toLowerCase();
  if (code === "manual") return "manual";
  if (code === "spx") return "spx";
  return "ghtk";
}

export function getShippingProviderAdapter(providerCode: string | null | undefined): ShippingProviderAdapter {
  return adapters[normalizeShippingProviderCode(providerCode)];
}
