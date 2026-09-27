import { ScrollViewStyleReset } from "expo-router/html";
import type { PropsWithChildren } from "react";

// Expo's web-only static HTML wrapper. Route metadata comes from expo-router/head.
// https://docs.expo.dev/router/web/static-rendering/#root-html
export default function RootHtml({ children }: PropsWithChildren) {
  return <html lang="en"><head>
    <meta charSet="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="color-scheme" content="dark" />
    <ScrollViewStyleReset />
    <style>{`html,body,#root{background:#0e0d0b;} :focus-visible{outline:2px solid #e8b93c!important;outline-offset:3px;} a{color:inherit;} `}</style>
  </head><body>{children}</body></html>;
}
