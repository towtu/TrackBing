import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { Buffer } from 'node:buffer';
import { httpsOrigin, assertPublicKey } from './release.mjs';
import { crawlerFiles, makeSiteConfig, pageMetadata, PRIVATE_PATHS } from '../../src/lib/siteConfig.shared.mjs';

async function boundedBody(response, limit) {
  if (!response.body) throw new Error('Missing release response body.');
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > limit) throw new Error('Release response is too large.');
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } finally { await reader.cancel(); }
}
function tagAttribute(tag, key) {
  const attributes = Array.from(tag.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/g));
  return attributes.find(([, name]) => name.toLowerCase() === key)?.[3];
}
function headContent(html) {
  const document = html.replace(/<!--[\s\S]*?-->/g, '');
  const head = document.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1] ?? '';
  return head.replace(/<(script|style|textarea)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
}
function metadata(html, key) {
  const head = headContent(html).replace(/<title\b[^>]*>[\s\S]*?<\/title>/gi, '');
  const tags = Array.from(head.matchAll(/<meta\b[^>]*>/gi)).filter(([tag]) => (tagAttribute(tag, 'name') ?? tagAttribute(tag, 'property')) === key);
  return tags.length === 1 ? tagAttribute(tags[0][0], 'content') : undefined;
}
const assetPaths = ['/social-preview.png', '/favicon.ico'];
const builtAssets = () => Object.fromEntries(assetPaths.map(path => [path, readFileSync(`dist${path}`)]));
const sha256 = data => createHash('sha256').update(data).digest('hex');
function securityHeaders(response) {
  if (response.headers.get('x-content-type-options') !== 'nosniff' || response.headers.get('x-frame-options') !== 'DENY' || response.headers.get('referrer-policy') !== 'strict-origin-when-cross-origin' || response.headers.get('permissions-policy') !== 'camera=(self), microphone=(), geolocation=()' || !response.headers.get('content-security-policy')?.includes("frame-ancestors 'none'")) throw new Error('Release security headers are missing.');
}

/** Read-only release probes. No signed-in account, prompts, or paid provider calls. */
export async function smokeRelease(env, fetcher = fetch, expectedAssets = builtAssets()) {
  const origin = httpsOrigin(env.SMOKE_ORIGIN);
  const supabase = httpsOrigin(env.EXPO_PUBLIC_SUPABASE_URL);
  if (!/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? '')) throw new Error('Smoke checks require a full commit SHA.');
  assertPublicKey(env.EXPO_PUBLIC_SUPABASE_ANON_KEY);
  const pages = ['/', '/privacy', '/terms'];
  const config = makeSiteConfig({ origin: env.EXPO_PUBLIC_SITE_ORIGIN ?? origin, operator: env.EXPO_PUBLIC_LEGAL_OPERATOR, privacyEmail: env.EXPO_PUBLIC_PRIVACY_EMAIL, legalReviewed: env.EXPO_PUBLIC_LEGAL_REVIEWED });
  if (!config.origin) throw new Error('Configure a valid canonical HTTPS origin.');
  const checked = [];
  const headers = env.VERCEL_AUTOMATION_BYPASS_SECRET ? { 'x-vercel-protection-bypass': env.VERCEL_AUTOMATION_BYPASS_SECRET } : {};
  const deadline = AbortSignal.timeout(90_000);
  const options = () => ({ redirect: 'manual', signal: AbortSignal.any([deadline, AbortSignal.timeout(15_000)]) });
  const get = (base, path, requestHeaders = {}) => fetcher(`${base}${path}`, { method: 'GET', headers: requestHeaders, ...options() });
  for (const path of pages) {
    const response = await get(origin, path, headers);
    if (response.status !== 200 || !response.headers.get('content-type')?.includes('text/html')) throw new Error(`Public route smoke failed: ${path}.`);
    securityHeaders(response);
    const html = (await boundedBody(response, 1024 * 1024)).toString('utf8');
    const required = { '/': ['TrackBing', 'Sign In'], '/privacy': ['Privacy policy', 'Account, goals, and food diary'], '/terms': ['Terms and conditions', 'Nutrition and health limitations'] }[path];
    if (!required.every(text => html.includes(text)) || !/<title\b[^>]*>[^<]+<\/title>/i.test(html) || !metadata(html, 'description')) throw new Error(`Public route content is missing: ${path}.`);
    const expected = pageMetadata(path, config);
    const head = headContent(html);
    const titles = Array.from(head.matchAll(/<title\b[^>]*>([^<]*)<\/title>/gi));
    const canonical = Array.from(head.matchAll(/<link\b[^>]*>/gi)).filter(([tag]) => tagAttribute(tag, 'rel') === 'canonical');
    if (titles.length !== 1 || titles[0][1] !== expected.title || metadata(html, 'robots') !== expected.robots || canonical.length !== 1 || tagAttribute(canonical[0][0], 'href') !== expected.canonical || metadata(html, 'og:image') !== expected.socialImage) throw new Error(`Public route metadata is incorrect: ${path}.`);
    checked.push(path);
  }
  for (const path of PRIVATE_PATHS) {
    const response = await get(origin, path, headers);
    if (response.status !== 200 || !response.headers.get('content-type')?.includes('text/html')) throw new Error(`Private route smoke failed: ${path}.`);
    const html = (await boundedBody(response, 1024 * 1024)).toString('utf8');
    if (metadata(html, 'robots') !== 'noindex,nofollow') throw new Error(`Private route must be noindex: ${path}.`);
  }
  const crawlers = crawlerFiles(config);
  for (const [path, expected] of [['/robots.txt', crawlers.robots], ['/sitemap.xml', crawlers.sitemap]]) {
    const response = await get(origin, path, headers);
    if (response.status !== 200 || (await boundedBody(response, 16 * 1024)).toString('utf8').trim() !== expected.trim()) throw new Error(`Release crawler policy is incorrect: ${path}.`);
  }
  for (const path of assetPaths) {
    const response = await get(origin, path, headers);
    if (response.status !== 200 || !response.headers.get('content-type')?.startsWith('image/')) throw new Error(`Release asset is missing: ${path}.`);
    const data = await boundedBody(response, 512 * 1024);
    const valid = path.endsWith('.png') ? data.length >= 24 && data.toString('hex', 0, 8) === '89504e470d0a1a0a' && data.readUInt32BE(16) === 1200 && data.readUInt32BE(20) === 630 : data.length >= 6 && data.readUInt32LE(0) === 65536 && data.readUInt16LE(4) > 0;
    if (!valid || !expectedAssets[path] || sha256(data) !== sha256(expectedAssets[path])) throw new Error(`Release asset differs from the tested build: ${path}.`);
  }
  const manifest = await get(origin, '/release.json', headers);
  // Bind deployed content to this commit; never write response bodies to reports.
  if (manifest.status !== 200 || JSON.parse((await boundedBody(manifest, 1024)).toString('utf8')).sha !== env.GITHUB_SHA) throw new Error('The site is not serving this tested commit.');
  const missing = await get(origin, `/__missing_trackbing_${env.GITHUB_SHA}/`, headers);
  await missing.body?.cancel();
  if (missing.status !== 404) throw new Error('Unknown routes must return HTTP 404.');
  // Never send the deployment bypass credential over HTTP or follow its redirect.
  const http = await get(origin.replace('https:', 'http:'), '/');
  await http.body?.cancel();
  if (![301, 308].includes(http.status) || http.headers.get('location') !== `${origin}/`) throw new Error('HTTP must redirect directly to the same HTTPS origin.');
  const settings = await get(supabase, '/auth/v1/settings', { apikey: env.EXPO_PUBLIC_SUPABASE_ANON_KEY });
  await settings.body?.cancel();
  if (settings.status !== 200) throw new Error('The public client key does not match the deployed Supabase project.');
  for (const name of ['bee-chat', 'ai-food', 'ai-label', 'usda-search', 'billing']) {
    const response = await fetcher(`${supabase}/functions/v1/${name}`, { method: 'POST', headers: { apikey: env.EXPO_PUBLIC_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' }, body: '{}', ...options() });
    await response.body?.cancel();
    if (response.status !== 401) throw new Error(`Unauthenticated access must be denied: ${name}.`);
  }
  return { sha: env.GITHUB_SHA, origin, publicRoutes: checked, privateNoindexRoutes: PRIVATE_PATHS, crawlers: true, brandingAssets: true, httpsRedirect: true, unknownStatus: 404, unauthenticatedStatus: 401 };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await smokeRelease(process.env);
    mkdirSync('output/release', { recursive: true });
    const filename = process.env.SMOKE_STAGE === 'candidate' ? 'candidate-smoke.json' : 'live-smoke.json';
    writeFileSync(`output/release/${filename}`, `${JSON.stringify(result, null, 2)}\n`);
    console.log('Public routes, release identity and unauthenticated API boundaries passed.');
  } catch { console.error('Release smoke failed. Check routes, headers, commit identity, deployment protection and authenticated API boundaries.'); process.exitCode = 1; }
}
