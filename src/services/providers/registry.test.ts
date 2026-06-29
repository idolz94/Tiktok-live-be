import { describe, it, expect } from "vitest";
import { normalizeShippingProviderCode, getShippingProviderAdapter } from "./registry.js";

describe("normalizeShippingProviderCode", () => {
  it("returns 'spx' for 'spx'", () => {
    expect(normalizeShippingProviderCode("spx")).toBe("spx");
  });

  it("returns 'manual' for 'manual'", () => {
    expect(normalizeShippingProviderCode("manual")).toBe("manual");
  });

  it("normalizes uppercase input", () => {
    expect(normalizeShippingProviderCode("SPX")).toBe("spx");
    expect(normalizeShippingProviderCode("MANUAL")).toBe("manual");
  });

  it("defaults to 'manual' for unknown codes", () => {
    expect(normalizeShippingProviderCode("ghtk")).toBe("manual");
    expect(normalizeShippingProviderCode("ghn")).toBe("manual");
    expect(normalizeShippingProviderCode("")).toBe("manual");
  });

  it("defaults to 'manual' for null or undefined", () => {
    expect(normalizeShippingProviderCode(null)).toBe("manual");
    expect(normalizeShippingProviderCode(undefined)).toBe("manual");
  });

  it("trims whitespace", () => {
    expect(normalizeShippingProviderCode("  spx  ")).toBe("spx");
    expect(normalizeShippingProviderCode(" manual ")).toBe("manual");
  });
});

describe("getShippingProviderAdapter", () => {
  it("returns adapter with correct code for each provider", () => {
    expect(getShippingProviderAdapter("spx").code).toBe("spx");
    expect(getShippingProviderAdapter("manual").code).toBe("manual");
  });

  it("returns manual adapter for unknown provider", () => {
    expect(getShippingProviderAdapter("unknown").code).toBe("manual");
    expect(getShippingProviderAdapter(null).code).toBe("manual");
  });

  it("adapters have required methods", () => {
    for (const code of ["spx", "manual"] as const) {
      const adapter = getShippingProviderAdapter(code);
      expect(typeof adapter.getFee).toBe("function");
      expect(typeof adapter.submit).toBe("function");
      expect(typeof adapter.tracking).toBe("function");
      expect(typeof adapter.cancel).toBe("function");
    }
  });
});
