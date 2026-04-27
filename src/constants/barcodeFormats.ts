export function getWebBarcodeFormats(BarcodeFormat: {
  EAN_13: unknown;
  EAN_8: unknown;
  UPC_A: unknown;
  UPC_E: unknown;
  CODE_128: unknown;
  CODE_39: unknown;
  ITF: unknown;
  QR_CODE: unknown;
}) {
  return [
    BarcodeFormat.EAN_13,
    BarcodeFormat.EAN_8,
    BarcodeFormat.UPC_A,
    BarcodeFormat.UPC_E,
    BarcodeFormat.CODE_128,
    BarcodeFormat.CODE_39,
    BarcodeFormat.ITF,
    BarcodeFormat.QR_CODE,
  ];
}
