import { WebView } from "react-native-webview";
import { StyleSheet, Platform } from "react-native";
import { HTML5_QRCODE_SOURCE } from "@/src/lib/html5QrcodeSource";

interface Props {
  onBarcodeScanned: (data: string) => void;
  active: boolean;
}

const SCANNER_HTML = `<!DOCTYPE html><html><head>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>*{margin:0;padding:0;box-sizing:border-box}
    body{background:#000;width:100vw;height:100vh;overflow:hidden}
    #reader{position:relative;width:100%;height:100vh;overflow:hidden;border:none!important}
    #reader__scan_region{position:absolute!important;top:0!important;left:0!important;width:100%!important;height:100%!important;overflow:hidden!important}
    #reader__scan_region video{display:block!important;width:100%!important;height:100%!important;object-fit:cover!important}
    #reader__scan_region>*:not(video){display:none!important}
    #reader__dashboard{display:none!important}
  </style>
</head><body><div id="reader"></div>
<script>${HTML5_QRCODE_SOURCE}</script>
<script>
  var F = Html5QrcodeSupportedFormats;
  var scanner = new Html5Qrcode("reader");
  scanner.start(
    {facingMode:"environment"},
    {fps:10,
     formatsToSupport:[F.EAN_13,F.EAN_8,F.UPC_A,F.UPC_E,F.CODE_128,F.CODE_39,F.ITF,F.QR_CODE]},
    function(d){
      scanner.stop().catch(function(){});
      window.ReactNativeWebView.postMessage(JSON.stringify({type:"barcode",data:d}));
    },
    function(){}
  ).catch(function(e){
    if(window.ReactNativeWebView)
      window.ReactNativeWebView.postMessage(JSON.stringify({type:"error",message:String(e)}));
  });
</script></body></html>`;

const handleMessage = (onBarcodeScanned: (data: string) => void) =>
  (event: { nativeEvent: { data: string } }) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg.type === "barcode") onBarcodeScanned(msg.data);
    } catch {}
  };

// Grant the camera only — never blanket-approve whatever the page requests.
const grantCameraOnly = (request: any) => {
  const resources: string[] = Array.isArray(request?.resources)
    ? request.resources
    : [];
  const camera = resources.filter((r) => r.includes("VIDEO_CAPTURE"));
  request.grant(camera);
};

// The scanner is a self-contained inline document; it should never navigate
// away. Allow only the initial inline/local origins and block anything else
// (e.g. a scanned QR code that encodes a URL).
const ALLOWED_LOAD_PREFIXES = ["about:blank", "data:", "https://localhost"];
const allowInlineLoadsOnly = (req: { url?: string }) => {
  const url = req?.url ?? "";
  return ALLOWED_LOAD_PREFIXES.some((prefix) => url.startsWith(prefix));
};

export default function AndroidBarcodeScanner({ onBarcodeScanned, active }: Props) {
  if (!active) return null;

  // Android: originWhitelist must be ['*'] so the RN WebView bridge injection
  // succeeds. baseUrl 'https://localhost' makes getUserMedia work (secure context).
  // Without these, the bridge injection fails → window.ReactNativeWebView is
  // undefined when the camera-start catch handler runs → uncaught error → crash.
  if (Platform.OS === "android") {
    return (
      <WebView
        source={{ html: SCANNER_HTML, baseUrl: "https://localhost" }}
        style={StyleSheet.absoluteFillObject}
        javaScriptEnabled
        mediaPlaybackRequiresUserAction={false}
        allowsInlineMediaPlayback
        originWhitelist={["*"]}
        onPermissionRequest={grantCameraOnly}
        onShouldStartLoadWithRequest={allowInlineLoadsOnly}
        onMessage={handleMessage(onBarcodeScanned)}
      />
    );
  }

  // iOS: inline HTML with about:blank origin works fine on WKWebView.
  return (
    <WebView
      source={{ html: SCANNER_HTML }}
      style={StyleSheet.absoluteFillObject}
      javaScriptEnabled
      mediaPlaybackRequiresUserAction={false}
      allowsInlineMediaPlayback
      originWhitelist={["about:blank"]}
      onPermissionRequest={grantCameraOnly}
      onShouldStartLoadWithRequest={allowInlineLoadsOnly}
      onMessage={handleMessage(onBarcodeScanned)}
    />
  );
}
