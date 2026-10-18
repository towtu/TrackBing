/** Pure display validation, shared by Edge Functions and every Expo client. */
export function isSafeGroundingUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.length > 2048 || /[\s\u0000-\u001f\u007f\\]/u.test(value)) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return false;
    const host = url.hostname.toLowerCase();
    // Citation links are never fetched by our server. Still refuse local and IP targets when opened.
    if (host.includes(":") || /^[\d.]+$/.test(host) || host.endsWith(".")) return false;
    if (/(?:^|\.)(?:localhost|local|internal|intranet|lan|home|test|invalid|example|arpa|onion|nip\.io|sslip\.io|localtest\.me)$/.test(host)) return false;
    const labels = host.split(".");
    return labels.length >= 2 && /^[a-z]{2,63}$/.test(labels[labels.length - 1]) && labels.every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
  } catch {
    return false;
  }
}

function decodeAttribute(value: string): string {
  const entities: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", colon: ":", tab: "\t", newline: "\n" };
  return value.replace(/&(?:#(x[0-9a-f]+|[0-9]+);?|([a-z]+);)/gi, (_match, numeric: string | undefined, name: string | undefined) => {
    if (numeric) {
      const code = numeric[0].toLowerCase() === "x" ? parseInt(numeric.slice(1), 16) : parseInt(numeric, 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "\u0000";
    }
    return entities[(name ?? "").toLowerCase()] ?? "\u0000";
  });
}

function safeCss(value: string): boolean {
  const css = value.replace(/\/\*[\s\S]*?\*\//g, "").toLowerCase();
  // Refuse selectors that reach the shadow host or content outside this widget.
  // Also refuse escaped tokens, external resources, execution, and untrusted at-rules.
  return !/[\\<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(css)
    && !/(?::host\b|::(?:slotted|part)\b)/.test(css)
    && !/(?:url\s*\(|image-set\s*\(|expression\s*\(|behavior\s*:|-moz-binding|javascript\s*:|https?\s*:)/.test(css)
    && !/@(?!media\b|supports\b)/.test(css);
}

const HTML_TAGS = new Set(["div", "span", "a", "p", "br", "style"]);
const SVG_TAGS = new Set(["svg", "g", "path", "circle", "rect", "line", "polyline", "polygon", "ellipse", "title", "desc"]);
const ATTRIBUTES = new Set([
  "class", "id", "style", "role", "aria-label", "aria-hidden", "tabindex", "title", "href", "target", "rel",
  "width", "height", "viewbox", "fill", "fill-rule", "clip-rule", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin",
  "d", "x", "y", "x1", "x2", "y1", "y2", "cx", "cy", "r", "rx", "ry", "points", "transform", "xmlns", "focusable",
]);

/** Validate rather than rewrite: the supplied Google widget must be shown intact or rejected. */
export function validateSuggestionsHtml(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim() || value.length > 64_000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) return false;
  const stack: string[] = [];
  let cursor = 0;
  let links = 0;
  while (cursor < value.length) {
    const opening = value.indexOf("<", cursor);
    if (opening === -1) break;
    cursor = opening;
    if (value.startsWith("<!--", cursor)) {
      const end = value.indexOf("-->", cursor + 4);
      if (end < 0 || value.slice(cursor + 4, end).includes("--")) return false;
      cursor = end + 3; continue;
    }
    const tag = /^<(\/?)([a-z][a-z0-9]*)(\s[^<>]*?)?\s*(\/?)>/i.exec(value.slice(cursor));
    if (!tag) return false;
    const name = tag[2].toLowerCase();
    if (!HTML_TAGS.has(name) && !SVG_TAGS.has(name)) return false;
    cursor += tag[0].length;
    if (tag[1]) {
      if (tag[3]?.trim() || tag[4] || stack.pop() !== name) return false;
      continue;
    }
    const inSvg = stack.includes("svg");
    if (name === "svg" ? inSvg : SVG_TAGS.has(name) !== inSvg) return false;
    if (name === "a" && stack.includes("a")) return false;
    const attributes = tag[3] ?? "";
    let attributeCursor = 0;
    const seen = new Set<string>();
    while (attributeCursor < attributes.length) {
      if (!attributes.slice(attributeCursor).trim()) break;
      const attr = /^\s+([a-z][a-z0-9-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attributes.slice(attributeCursor));
      if (!attr) return false;
      attributeCursor += attr[0].length;
      const key = attr[1].toLowerCase(); const decoded = decodeAttribute(attr[2] ?? attr[3]);
      if (!ATTRIBUTES.has(key) || seen.has(key) || decoded.includes("\u0000")) return false;
      seen.add(key);
      if (key === "style" && !safeCss(decoded)) return false;
      if (key === "href") {
        if (name !== "a" || !isSafeGroundingUrl(decoded)) return false;
        const url = new URL(decoded);
        if (!["google.com", "www.google.com"].includes(url.hostname) || url.pathname !== "/search") return false;
        links++;
      }
      if (key === "target" && (name !== "a" || !["_blank", "_self"].includes(decoded))) return false;
      if (key === "xmlns" && (name !== "svg" || decoded !== "http://www.w3.org/2000/svg")) return false;
      if (["fill", "stroke"].includes(key) && !/^(?:none|currentcolor|transparent|#[a-f0-9]{3,8}|[a-z]+|rgba?\([\d.,%\s]+\))$/i.test(decoded)) return false;
    }
    if (name === "a" && !seen.has("href")) return false;
    if (name === "style") {
      if (tag[4]) return false;
      const end = /<\/style\s*>/i.exec(value.slice(cursor));
      if (!end || !safeCss(value.slice(cursor, cursor + end.index))) return false;
      cursor += end.index + end[0].length; continue;
    }
    if (tag[4] && !inSvg && name !== "svg" && name !== "br") return false;
    if (name !== "br" && !tag[4]) stack.push(name);
    if (stack.length > 32) return false;
  }
  return stack.length === 0 && links > 0;
}
