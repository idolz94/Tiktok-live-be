import { describe, expect, it } from "vitest";
import { parseQuantityFromComment, parsePriceFromComment, resolveFallbackCommentPrice } from "./order-core.service.js";

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

describe("resolveFallbackCommentPrice", () => {
  it("multiplies a small bare number by 1000", () => {
    expect(resolveFallbackCommentPrice("cho e xem mã 47 dc k")).toBe(47000);
    expect(resolveFallbackCommentPrice("47")).toBe(47000);
  });
  it("keeps parsed prices intact", () => {
    expect(resolveFallbackCommentPrice("695k")).toBe(695000);
    expect(resolveFallbackCommentPrice("đã săn 133k")).toBe(133000);
  });
  it("caps large numbers (e.g. phone numbers) to the default", () =>
    expect(resolveFallbackCommentPrice("0912345678")).toBe(20000));
  it("defaults to 20000 when the comment has no number", () =>
    expect(resolveFallbackCommentPrice("Nhận về có hộp ko ạ")).toBe(20000));
});
