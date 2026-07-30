import { describe, expect, it } from "vitest";
import { parseBarcode, sanitizeBarcodeInput } from "./barcodes";

describe("sanitizeBarcodeInput", () => {
  it("keeps digits and leading zeroes while filtering typed characters", () => {
    expect(sanitizeBarcodeInput(" 0123-45ab ")).toBe("012345");
  });

  it("caps editable input at 32 digits", () => {
    expect(sanitizeBarcodeInput("1".repeat(40))).toBe("1".repeat(32));
  });
});

describe("parseBarcode", () => {
  it("accepts a valid barcode without converting it to a number", () => {
    expect(parseBarcode("00012345")).toEqual({
      ok: true,
      barcode: "00012345",
    });
  });

  it("accepts an empty optional barcode as null", () => {
    expect(parseBarcode("", { optional: true })).toEqual({
      ok: true,
      barcode: null,
    });
  });

  it("rejects empty required input", () => {
    expect(parseBarcode("")).toEqual({
      ok: false,
      reason: "Enter a barcode number.",
    });
  });

  it("rejects values shorter than four digits", () => {
    expect(parseBarcode("123")).toEqual({
      ok: false,
      reason: "Barcode numbers must contain 4 to 32 digits.",
    });
  });

  it("rejects letters, punctuation, and QR URLs instead of extracting digits", () => {
    expect(parseBarcode("4800-1234").ok).toBe(false);
    expect(parseBarcode("https://example.com/48001234").ok).toBe(false);
  });

  it("rejects values longer than 32 digits", () => {
    expect(parseBarcode("1".repeat(33)).ok).toBe(false);
  });
});
