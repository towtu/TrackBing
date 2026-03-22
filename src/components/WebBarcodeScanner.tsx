import React, { useEffect, useRef } from "react";
import { Platform } from "react-native";

interface WebBarcodeScannerProps {
  onBarcodeScanned: (data: string) => void;
  active: boolean;
}

export default function WebBarcodeScanner({
  onBarcodeScanned,
  active,
}: WebBarcodeScannerProps) {
  const scannerRef = useRef<any>(null);
  const containerId = "web-barcode-scanner";
  const callbackRef = useRef(onBarcodeScanned);
  callbackRef.current = onBarcodeScanned;

  useEffect(() => {
    if (Platform.OS !== "web" || !active) return;

    let html5QrCode: any = null;
    let stopped = false;

    const startScanner = async () => {
      const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import(
        "html5-qrcode"
      );

      if (stopped) return;

      html5QrCode = new Html5Qrcode(containerId, {
        formatsToSupport: [
          Html5QrcodeSupportedFormats.EAN_13,
          Html5QrcodeSupportedFormats.EAN_8,
          Html5QrcodeSupportedFormats.UPC_A,
          Html5QrcodeSupportedFormats.UPC_E,
          Html5QrcodeSupportedFormats.CODE_128,
          Html5QrcodeSupportedFormats.CODE_39,
          Html5QrcodeSupportedFormats.ITF,
          Html5QrcodeSupportedFormats.QR_CODE,
        ],
        verbose: false,
      });
      scannerRef.current = html5QrCode;

      try {
        await html5QrCode.start(
          { facingMode: "environment" },
          {
            fps: 15,
            // Use a responsive scan region instead of fixed pixels
            qrbox: (viewfinderWidth: number, viewfinderHeight: number) => {
              const w = Math.floor(viewfinderWidth * 0.85);
              const h = Math.floor(viewfinderHeight * 0.4);
              return { width: Math.max(w, 200), height: Math.max(h, 100) };
            },
            aspectRatio: 1.0,
            disableFlip: false,
          },
          (decodedText: string) => {
            callbackRef.current(decodedText);
          },
          () => {}
        );
      } catch (err) {
        console.error("Failed to start web barcode scanner:", err);
      }
    };

    startScanner();

    return () => {
      stopped = true;
      if (html5QrCode && html5QrCode.isScanning) {
        html5QrCode.stop().catch(() => {});
      }
    };
  }, [active]);

  if (Platform.OS !== "web") return null;

  return (
    <div
      id={containerId}
      style={{
        width: "100%",
        height: "100%",
        position: "absolute",
        top: 0,
        left: 0,
      }}
    />
  );
}
