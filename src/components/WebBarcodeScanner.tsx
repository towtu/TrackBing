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
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const callbackRef = useRef(onBarcodeScanned);
  callbackRef.current = onBarcodeScanned;

  useEffect(() => {
    if (Platform.OS !== "web" || !active) return;

    let stopped = false;
    let stream: MediaStream | null = null;
    let reader: any = null;

    const startScanner = async () => {
      const { BrowserMultiFormatReader } = await import("@zxing/browser");
      const { DecodeHintType, BarcodeFormat } = await import("@zxing/library");

      if (stopped) return;

      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [
        BarcodeFormat.EAN_13,
        BarcodeFormat.EAN_8,
        BarcodeFormat.UPC_A,
        BarcodeFormat.UPC_E,
        BarcodeFormat.CODE_128,
        BarcodeFormat.CODE_39,
        BarcodeFormat.ITF,
        BarcodeFormat.QR_CODE,
      ]);
      hints.set(DecodeHintType.TRY_HARDER, true);

      reader = new BrowserMultiFormatReader(hints, {
        delayBetweenScanAttempts: 100,
      });

      const videoElement = videoRef.current;
      if (!videoElement || stopped) return;

      try {
        // Get the back camera stream manually for better control
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "environment",
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        });

        if (stopped) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        videoElement.srcObject = stream;
        await videoElement.play();

        // Continuously decode from the video element
        const decodeLoop = async () => {
          while (!stopped) {
            try {
              const result = await reader.decodeOnce(videoElement);
              if (result && !stopped) {
                callbackRef.current(result.getText());
                return; // stop after first successful scan
              }
            } catch {
              // No barcode found in this frame, keep trying
            }
            await new Promise((r) => setTimeout(r, 150));
          }
        };

        decodeLoop();
      } catch (err) {
        console.error("Failed to start web barcode scanner:", err);
      }
    };

    startScanner();

    return () => {
      stopped = true;
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
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
