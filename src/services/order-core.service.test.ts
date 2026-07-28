import { describe, expect, it } from "vitest";
import { parseQuantityFromComment, parsePriceFromComment } from "./order-core.service.js";

describe("parseQuantityFromComment", () => {
  it("uses explicit quantity markers only", () => {
    expect(parseQuantityFromComment("Mã 3 đi shop")).toBe(1);
    expect(parseQuantityFromComment("Mã 3 đi shop x6")).toBe(6);
    expect(parseQuantityFromComment("Mã 3 đi shop sl 4")).toBe(4);
  });
});

describe("parsePriceFromComment", () => {
  it("parses 695k", () => expect(parsePriceFromComment("695k")).toBe(695000));
  it("parses 695K", () => expect(parsePriceFromComment("695K")).toBe(695000));
  it("parses 695.000", () => expect(parsePriceFromComment("695.000")).toBe(695000));
  it("parses 695,000", () => expect(parsePriceFromComment("695,000")).toBe(695000));
  it("parses plain 695000", () => expect(parsePriceFromComment("695000")).toBe(695000));
  it("ignores single small numbers", () => expect(parsePriceFromComment("x2")).toBeNull());
  it("parses price from full comment", () => expect(parsePriceFromComment("Mã 3 đi shop 250k")).toBe(250000));
  it("ignores qty marker that doubles as number", () => {
    // "x6" — 6 is below 1000, not a price
    expect(parsePriceFromComment("x6")).toBeNull();
  });
});
