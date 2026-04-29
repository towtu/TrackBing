import { WebView } from "react-native-webview";
import { StyleSheet } from "react-native";
import { HTML5_QRCODE_SOURCE } from "@/src/lib/html5QrcodeSource";

interface Props {
  onBarcodeScanned: (data: string) => void;
  active: boolean;
}

const SCANNER_HTML = `<!DOCTYPE html><html><head>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>*{margin:0;padding:0;box-sizing:border-box}
    body{background:#000;width:100vw;height:100vh;overflow:hidden}
    #reader{width:100%;height:100%}
    #reader video{width:100%;height:100%;object-fit:cover}
  </style>
</head><body><div id="reader"></div>
<script>${HTML5_QRCODE_SOURCE}</script>
<script>
  var F = Html5QrcodeSupportedFormats;
  var scanner = new Html5Qrcode("reader");
  scanner.start(
    {facingMode:"environment"},
    {fps:10,qrbox:{width:260,height:160},
     formatsToSupport:[F.EAN_13,F.EAN_8,F.UPC_A,F.UPC_E,F.CODE_128,F.CODE_39,F.ITF,F.QR_CODE]},
    function(d){
      scanner.stop().catch(function(){});
      window.ReactNativeWebView.postMessage(JSON.stringify({type:"barcode",data:d}));
    },
    function(){}
  ).catch(function(e){
    window.ReactNativeWebView.postMessage(JSON.stringify({type:"error",message:String(e)}));
  });
</script></body></html>`;

export default function AndroidBarcodeScanner({ onBarcodeScanned, active }: Props) {
  if (!active) return null;

  return (
    <WebView
      source={{ html: SCANNER_HTML }}
      style={StyleSheet.absoluteFillObject}
      javaScriptEnabled
      mediaPlaybackRequiresUserAction={false}
      allowsInlineMediaPlayback
      originWhitelist={["about:blank"]}
      onPermissionRequest={(request: any) => request.grant(request.resources)}
      onMessage={(event) => {
        try {
          const msg = JSON.parse(event.nativeEvent.data);
          if (msg.type === "barcode") onBarcodeScanned(msg.data);
        } catch {}
      }}
    />
  );
}

