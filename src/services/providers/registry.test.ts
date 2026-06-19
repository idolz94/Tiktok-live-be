import { describe, it, expect } from "vitest";
import { normalizeShippingProviderCode, getShippingProviderAdapter } from "./registry.js";

describe("normalizeShippingProviderCode", () => {
  it("returns 'ghtk' for 'ghtk'", () => {
    expect(normalizeShippingProviderCode("ghtk")).toBe("ghtk");
  });

  it("returns 'spx' for 'spx'", () => {
    expect(normalizeShippingProviderCode("spx")).toBe("spx");
  });

  it("returns 'manual' for 'manual'", () => {
    expect(normalizeShippingProviderCode("manual")).toBe("manual");
  });

  it("normalizes uppercase input", () => {
    expect(normalizeShippingProviderCode("GHTK")).toBe("ghtk");
    expect(normalizeShippingProviderCode("SPX")).toBe("spx");
    expect(normalizeShippingProviderCode("MANUAL")).toBe("manual");
  });

  it("defaults to 'ghtk' for unknown codes", () => {
    expect(normalizeShippingProviderCode("ghn")).toBe("ghtk");
    expect(normalizeShippingProviderCode("viettel")).toBe("ghtk");
    expect(normalizeShippingProviderCode("")).toBe("ghtk");
  });

  it("defaults to 'ghtk' for null or undefined", () => {
    expect(normalizeShippingProviderCode(null)).toBe("ghtk");
    expect(normalizeShippingProviderCode(undefined)).toBe("ghtk");
  });

  it("trims whitespace", () => {
    expect(normalizeShippingProviderCode("  ghtk  ")).toBe("ghtk");
    expect(normalizeShippingProviderCode(" spx ")).toBe("spx");
  });
});

describe("getShippingProviderAdapter", () => {
  it("returns adapter with correct code for each provider", () => {
    expect(getShippingProviderAdapter("ghtk").code).toBe("ghtk");
    expect(getShippingProviderAdapter("spx").code).toBe("spx");
    expect(getShippingProviderAdapter("manual").code).toBe("manual");
  });

  it("returns ghtk adapter for unknown provider", () => {
    expect(getShippingProviderAdapter("unknown").code).toBe("ghtk");
    expect(getShippingProviderAdapter(null).code).toBe("ghtk");
  });

  it("adapters have required methods", () => {
    for (const code of ["ghtk", "spx", "manual"] as const) {
      const adapter = getShippingProviderAdapter(code);
      expect(typeof adapter.getFee).toBe("function");
      expect(typeof adapter.submit).toBe("function");
      expect(typeof adapter.tracking).toBe("function");
      expect(typeof adapter.cancel).toBe("function");
    }
  });
});
