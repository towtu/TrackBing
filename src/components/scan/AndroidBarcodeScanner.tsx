import { WebView } from "react-native-webview";
import { StyleSheet } from "react-native";

interface Props {
  onBarcodeScanned: (data: string) => void;
  active: boolean;
}

const SCANNER_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{background:#000;width:100vw;height:100vh;overflow:hidden}
    #reader{width:100%;height:100%}
    #reader video{width:100%;height:100%;object-fit:cover}
  </style>
</head>
<body>
  <div id="reader"></div>
  <script src="https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js"></script>
  <script>
    const F = Html5QrcodeSupportedFormats;
    const scanner = new Html5Qrcode("reader");
    scanner.start(
      {facingMode:"environment"},
      {
        fps: 10,
        qrbox: {width:260, height:160},
        formatsToSupport: [
          F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E,
          F.CODE_128, F.CODE_39, F.ITF, F.QR_CODE
        ]
      },
      function(data) {
        scanner.stop().catch(function(){});
        window.ReactNativeWebView.postMessage(JSON.stringify({type:"barcode",data:data}));
      },
      function(){}
    ).catch(function(err) {
      window.ReactNativeWebView.postMessage(JSON.stringify({type:"error",message:String(err)}));
    });
  </script>
</body>
</html>`;

export default function AndroidBarcodeScanner({ onBarcodeScanned, active }: Props) {
  if (!active) return null;

  return (
    <WebView
      source={{ html: SCANNER_HTML }}
      style={StyleSheet.absoluteFillObject}
      javaScriptEnabled
      mediaPlaybackRequiresUserAction={false}
      allowsInlineMediaPlayback
      originWhitelist={["*"]}
      onPermissionRequest={(request) => request.grant(request.resources)}
      onMessage={(event) => {
        try {
          const msg = JSON.parse(event.nativeEvent.data);
          if (msg.type === "barcode") onBarcodeScanned(msg.data);
        } catch {}
      }}
    />
  );
}
