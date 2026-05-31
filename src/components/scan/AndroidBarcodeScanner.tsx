import { Platform } from "react-native";
import AndroidBarcodeScannerNative from "./AndroidBarcodeScanner.native";
import AndroidBarcodeScannerWeb from "./AndroidBarcodeScanner.web";

const AndroidBarcodeScanner = Platform.select({
  native: AndroidBarcodeScannerNative,
  default: AndroidBarcodeScannerWeb,
}) as typeof AndroidBarcodeScannerNative;

export default AndroidBarcodeScanner;
