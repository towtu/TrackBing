import React from "react";
import { WebView } from "react-native-webview";
import { buildBeeSuggestionsDocument } from "./BeeGroundedAnswer.shared";
import { isSafeGroundingUrl } from "../../../supabase/functions/_shared/beeGrounding";

export function BeeGroundedSuggestions({ html, onOpenUrl }: { html: string; onOpenUrl: (url: string) => void }) {
  const document = buildBeeSuggestionsDocument(html);
  if (!document) return null;

  return (
    <WebView
      accessibilityLabel="Google Search suggestions"
      source={{ html: document }}
      originWhitelist={["*"]}
      javaScriptEnabled={false}
      javaScriptCanOpenWindowsAutomatically={false}
      domStorageEnabled={false}
      allowFileAccess={false}
      allowFileAccessFromFileURLs={false}
      allowUniversalAccessFromFileURLs={false}
      mixedContentMode="never"
      thirdPartyCookiesEnabled={false}
      sharedCookiesEnabled={false}
      cacheEnabled={false}
      incognito
      allowsLinkPreview={false}
      setSupportMultipleWindows={false}
      onShouldStartLoadWithRequest={(request) => {
        if (request.url === "about:blank") return true;
        if (isSafeGroundingUrl(request.url)) onOpenUrl(request.url);
        return false;
      }}
      onOpenWindow={(event) => {
        if (isSafeGroundingUrl(event.nativeEvent.targetUrl)) onOpenUrl(event.nativeEvent.targetUrl);
      }}
      style={{ height: 180, backgroundColor: "transparent" }}
    />
  );
}
