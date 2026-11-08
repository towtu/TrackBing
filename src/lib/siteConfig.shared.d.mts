export type SiteConfig = { origin: string | null; operator: string | null; privacyEmail: string | null; legalReviewed: boolean; indexable: boolean };
export function makeSiteConfig(values?: { origin?: string; operator?: string; privacyEmail?: string; legalReviewed?: string }): SiteConfig;
export const PUBLIC_PATHS: string[];
export const PRIVATE_PATHS: string[];
export function routeKind(pathname: string): "public" | "private" | "not-found";
export function pageMetadata(pathname: string, config: SiteConfig): {title: string; description: string; robots: string; canonical: string | null; socialImage: string | null};
export function crawlerFiles(config: SiteConfig): { robots: string; sitemap: string };
