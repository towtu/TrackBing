import { makeSiteConfig } from "./siteConfig.shared.mjs";
export { pageMetadata, routeKind } from "./siteConfig.shared.mjs";

// Expo statically substitutes only these public values; all API secrets stay on the server.
export const siteConfig = makeSiteConfig({
  origin: process.env.EXPO_PUBLIC_SITE_ORIGIN,
  operator: process.env.EXPO_PUBLIC_LEGAL_OPERATOR,
  privacyEmail: process.env.EXPO_PUBLIC_PRIVACY_EMAIL,
  legalReviewed: process.env.EXPO_PUBLIC_LEGAL_REVIEWED,
});
