/** Public-only configuration. Never pass a server credential into this module. */
export function makeSiteConfig(values = {}) {
  let origin = null;
  try {
    const url = new URL(values.origin || "");
    const host = url.hostname.toLowerCase();
    if (url.protocol === "https:" && !url.username && !url.password && !url.port &&
      url.pathname === "/" && !url.search && !url.hash &&
      host.length <= 253 && /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(host) &&
      !/(?:^|\.)(?:localhost|local|localdomain|internal|lan|home|test|invalid|example|arpa|onion|nip\.io|sslip\.io|localtest\.me)$/.test(host) &&
      !/(?:^|\.)example\.(?:com|net|org)$/.test(host)) origin = url.origin;
  } catch {
    // Missing/invalid public origin deliberately disables canonical URLs and indexing.
  }
  const operator = typeof values.operator === "string" && values.operator.trim().length <= 160
    ? values.operator.trim() : "";
  const email = typeof values.privacyEmail === "string" &&
    /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(values.privacyEmail) &&
    values.privacyEmail.length <= 254 ? values.privacyEmail : null;
  const legalReviewed = values.legalReviewed === "true" && !!operator && !!email;
  return { origin, operator: operator || null, privacyEmail: email, legalReviewed,
    indexable: !!origin && legalReviewed };
}

export const PUBLIC_PATHS = ["/", "/privacy", "/terms"];
export const PRIVATE_PATHS = ["/add", "/cookbook", "/stats", "/profile", "/plans", "/scan",
  "/my-foods", "/create-food", "/create-recipe"];

export function routeKind(pathname) {
  if (PUBLIC_PATHS.includes(pathname) || pathname === "/auth") return "public";
  return PRIVATE_PATHS.includes(pathname) ? "private" : "not-found";
}

export function pageMetadata(pathname, config) {
  const pages = {
    "/": ["TrackBing — calorie and macro tracking", "Track your food, review portions, and follow your daily calorie and macro goals with TrackBing."],
    "/auth": ["Sign in to TrackBing", "Sign in or create a TrackBing account to keep your food diary and nutrition goals together."],
    "/privacy": ["Privacy policy — TrackBing", "How TrackBing handles your account, food diary, body measurements, Bee chat, and saved preferences."],
    "/terms": ["Terms and conditions — TrackBing", "Read TrackBing's terms and the limits of nutrition estimates, food records, and Bee answers."],
  };
  const [title, description] = pages[pathname] || (routeKind(pathname) === "not-found" ? ["Page not found — TrackBing", "This page could not be found. Return to TrackBing to continue."] : ["TrackBing", "Your private food diary and nutrition goals."]);
  const publicPage = PUBLIC_PATHS.includes(pathname);
  return { title, description, robots: publicPage && config.indexable ? "index,follow" : "noindex,nofollow",
    canonical: publicPage && config.origin ? config.origin + pathname : null,
    socialImage: publicPage && config.origin ? config.origin + "/social-preview.png" : null };
}

export function crawlerFiles(config) {
  if (!config.indexable) return { robots: "User-agent: *\nDisallow: /\n",
    sitemap: '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>\n' };
  return {
    robots: "User-agent: *\nAllow: /\n" + ["/auth", "/(tabs)", "/_sitemap", "/+not-found", ...PRIVATE_PATHS].map(path => "Disallow: " + path).join("\n") +
      "\nSitemap: " + config.origin + "/sitemap.xml\n",
    sitemap: '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      PUBLIC_PATHS.map(path => "  <url><loc>" + config.origin + path + "</loc></url>").join("\n") + "\n</urlset>\n",
  };
}
