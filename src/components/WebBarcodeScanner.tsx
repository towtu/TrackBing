import React, { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { getWebBarcodeFormats } from "@/src/constants/barcodeFormats";

interface WebBarcodeScannerProps {
  onBarcodeScanned: (data: string) => void;
  active: boolean;
}

export default function WebBarcodeScanner({
  onBarcodeScanned,
  active,
}: WebBarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const callbackRef = useRef(onBarcodeScanned);
  callbackRef.current = onBarcodeScanned;

  useEffect(() => {
    if (Platform.OS !== "web" || !active) return;

    let stopped = false;
    let reader: any = null;

    const startScanner = async () => {
      const { BrowserMultiFormatReader } = await import("@zxing/browser");
      const { DecodeHintType, BarcodeFormat } = await import("@zxing/library");

      if (stopped) return;

      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, getWebBarcodeFormats(BarcodeFormat));
      hints.set(DecodeHintType.TRY_HARDER, true);

      reader = new BrowserMultiFormatReader(hints, {
        delayBetweenScanAttempts: 200,
      });

      const videoElement = videoRef.current;
      if (!videoElement || stopped) return;

      try {
        // decodeFromConstraints handles camera access + continuous scanning loop
        await reader.decodeFromConstraints(
          {
            video: {
              facingMode: { ideal: "environment" },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
          },
          videoElement,
          (result: any, err: any) => {
            if (result && !stopped) {
              stopped = true;
              callbackRef.current(result.getText());
            }
            // err here is just "no barcode found this frame" — not a real error
          }
        );
      } catch (err) {
        console.error("Failed to start web barcode scanner:", err);
      }
    };

    startScanner();

    return () => {
      stopped = true;
      if (reader) {
        try {
          reader.reset(); // stops camera stream + scanning loop
        } catch {}
      }
    };
  }, [active]);

  if (Platform.OS !== "web") return null;

  return (
    <video
      ref={videoRef as any}
      playsInline
      muted
      style={{
        width: "100%",
        height: "100%",
        position: "absolute",
        top: 0,
        left: 0,
        objectFit: "cover",
      }}
    />
  );
}
