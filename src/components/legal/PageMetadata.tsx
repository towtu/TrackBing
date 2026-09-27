import Head from "expo-router/head";
import { usePathname } from "expo-router";
import { pageMetadata, siteConfig } from "@/src/lib/siteConfig";

export function PageMetadata({ privateAccount = false }: { privateAccount?: boolean }) {
  const page = pageMetadata(usePathname(), siteConfig);
  const meta = privateAccount ? { ...page, robots: "noindex,nofollow", canonical: null, socialImage: null } : page;
  return <Head>
    <title>{meta.title}</title>
    <meta name="description" content={meta.description} />
    <meta name="robots" content={meta.robots} />
    {meta.canonical && <link rel="canonical" href={meta.canonical} />}
    {meta.canonical && <meta property="og:url" content={meta.canonical} />}
    {meta.socialImage && <meta property="og:type" content="website" />}
    {meta.socialImage && <meta property="og:title" content={meta.title} />}
    {meta.socialImage && <meta property="og:description" content={meta.description} />}
    {meta.socialImage && <meta property="og:image" content={meta.socialImage} />}
    {meta.socialImage && <meta property="og:image:width" content="1200" />}
    {meta.socialImage && <meta property="og:image:height" content="630" />}
    {meta.socialImage && <meta property="og:image:alt" content="TrackBing: your food, your goals, one day at a time." />}
    {meta.socialImage && <meta name="twitter:card" content="summary_large_image" />}
    {meta.socialImage && <meta name="twitter:title" content={meta.title} />}
    {meta.socialImage && <meta name="twitter:description" content={meta.description} />}
    {meta.socialImage && <meta name="twitter:image" content={meta.socialImage} />}
  </Head>;
}
