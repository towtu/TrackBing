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
  const containerRef = useRef<string>("web-barcode-scanner");

  useEffect(() => {
    if (Platform.OS !== "web" || !active) return;

    let html5QrCode: any = null;

    const startScanner = async () => {
      const { Html5Qrcode } = await import("html5-qrcode");
      html5QrCode = new Html5Qrcode(containerRef.current);
      scannerRef.current = html5QrCode;

      try {
        await html5QrCode.start(
          { facingMode: "environment" },
          {
            fps: 10,
            qrbox: { width: 260, height: 200 },
          },
          (decodedText: string) => {
            onBarcodeScanned(decodedText);
          },
          () => {
            // ignore scan failures (no barcode in frame)
          }
        );
      } catch (err) {
        console.error("Failed to start web barcode scanner:", err);
      }
    };

    startScanner();

    return () => {
      if (html5QrCode && html5QrCode.isScanning) {
        html5QrCode.stop().catch(() => {});
      }
    };
  }, [active]);

  if (Platform.OS !== "web") return null;

  return (
    <div
      id={containerRef.current}
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
