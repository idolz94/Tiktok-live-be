import { describe, it, expect } from "vitest";
import { createManualAdapter } from "./manual.adapter.js";

describe("createManualAdapter", () => {
  const adapter = createManualAdapter();

  it("has code 'manual'", () => {
    expect(adapter.code).toBe("manual");
  });

  describe("getFee", () => {
    it("returns zero fee with providerCode 'manual'", async () => {
      const result = await adapter.getFee({
        shopId: "shop1",
        orderId: "order1",
        pickProvince: "HN",
        pickDistrict: "CG",
        receiverProvince: "HCM",
        receiverDistrict: "Q1",
      });
      expect(result.providerCode).toBe("manual");
      expect(result.fee).toBe(0);
    });
  });

  describe("submit", () => {
    it("throws an error — manual shipping is handled directly", async () => {
      await expect(
        adapter.submit({
          shopId: "shop1",
          orderId: "order1",
          pickName: "Lumi",
          pickAddress: "123 Lê Lợi",
          pickProvince: "HN",
          pickDistrict: "CG",
          pickTel: "0901234567",
          receiverName: "Khách",
          receiverAddress: "456 Nguyễn Huệ",
          receiverProvince: "HCM",
          receiverDistrict: "Q1",
          receiverWard: "Bến Nghé",
          receiverTel: "0911111111",
        }),
      ).rejects.toThrow();
    });
  });

  describe("tracking", () => {
    it("returns submitted status with providerCode 'manual'", async () => {
      const result = await adapter.tracking({ shopId: "shop1", orderId: "order1" });
      expect(result.providerCode).toBe("manual");
      expect(result.status).toBe("submitted");
    });
  });

  describe("cancel", () => {
    it("returns cancelled status with providerCode 'manual'", async () => {
      const result = await adapter.cancel({ shopId: "shop1", orderId: "order1" });
      expect(result.providerCode).toBe("manual");
      expect(result.status).toBe("cancelled");
    });
  });
});
