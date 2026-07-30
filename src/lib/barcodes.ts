const BARCODE_PATTERN = /^[0-9]{4,32}$/;

export type ParsedBarcode =
  | { ok: true; barcode: string | null }
  | { ok: false; reason: string };

export function sanitizeBarcodeInput(value: string): string {
  return value.replace(/\D/g, "").slice(0, 32);
}

export function parseBarcode(
  value: string,
  options: { optional?: boolean } = {},
): ParsedBarcode {
  const barcode = value.trim();

  if (!barcode && options.optional) {
    return { ok: true, barcode: null };
  }

  if (!barcode) {
    return { ok: false, reason: "Enter a barcode number." };
  }

  if (!BARCODE_PATTERN.test(barcode)) {
    return {
      ok: false,
      reason: "Barcode numbers must contain 4 to 32 digits.",
    };
  }

  return { ok: true, barcode };
}
