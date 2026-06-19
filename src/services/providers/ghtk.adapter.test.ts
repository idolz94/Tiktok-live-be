import { describe, it, expect } from "vitest";
import { createGhtkAdapter } from "./ghtk.adapter.js";

describe("createGhtkAdapter", () => {
  const adapter = createGhtkAdapter();

  it("has code 'ghtk'", () => {
    expect(adapter.code).toBe("ghtk");
  });

  describe("normalizeWebhookStatus", () => {
    it("maps statusId -1 to cancelled", () => {
      const result = adapter.normalizeWebhookStatus!({ statusId: -1 });
      expect(result.shippingStatus).toBe("cancelled");
      expect(result.providerCode).toBe("ghtk");
      expect(result.statusCode).toBe("-1");
    });

    it("maps statusId 5 to delivered", () => {
      expect(adapter.normalizeWebhookStatus!({ statusId: 5 }).shippingStatus).toBe("delivered");
    });

    it("maps statusId 6 to delivered", () => {
      expect(adapter.normalizeWebhookStatus!({ statusId: 6 }).shippingStatus).toBe("delivered");
    });

    it("maps statusId 9 to returned", () => {
      expect(adapter.normalizeWebhookStatus!({ statusId: 9 }).shippingStatus).toBe("returned");
    });

    it("maps statusId 20 to returned", () => {
      expect(adapter.normalizeWebhookStatus!({ statusId: 20 }).shippingStatus).toBe("returned");
    });

    it("maps statusId 21 to returned", () => {
      expect(adapter.normalizeWebhookStatus!({ statusId: 21 }).shippingStatus).toBe("returned");
    });

    it("maps any other statusId to submitted", () => {
      expect(adapter.normalizeWebhookStatus!({ statusId: 1 }).shippingStatus).toBe("submitted");
      expect(adapter.normalizeWebhookStatus!({ statusId: 10 }).shippingStatus).toBe("submitted");
      expect(adapter.normalizeWebhookStatus!({ statusId: 99 }).shippingStatus).toBe("submitted");
    });

    it("includes statusCode and statusRaw as string of statusId", () => {
      const result = adapter.normalizeWebhookStatus!({ statusId: 5 });
      expect(result.statusCode).toBe("5");
      expect(result.statusRaw).toBe("5");
    });
  });
});
