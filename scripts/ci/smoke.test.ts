import { describe, expect, it } from 'vitest';
import { smokeRelease } from './smoke.mjs';
import { readFileSync } from 'node:fs';
import { crawlerFiles, makeSiteConfig, pageMetadata } from '../../src/lib/siteConfig.shared.mjs';
const env = { SMOKE_ORIGIN: 'https://trackbing-candidate.vercel.app', EXPO_PUBLIC_SUPABASE_URL: 'https://aaaaaaaaaaaaaaaaaaaa.supabase.co', EXPO_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_abcdefghijklmnopqrstuv', GITHUB_SHA: 'a'.repeat(40), VERCEL_AUTOMATION_BYPASS_SECRET: 'fixture-bypass' };
// Valid branded PNG plus a valid ICO wrapping the repository's PNG icon.
const preview = readFileSync('public/social-preview.png');
const iconPng = readFileSync('assets/images/favicon.png');
const iconHeader = Buffer.alloc(22);
iconHeader.writeUInt16LE(1, 2); iconHeader.writeUInt16LE(1, 4);
iconHeader[6] = iconPng.readUInt32BE(16) % 256; iconHeader[7] = iconPng.readUInt32BE(20) % 256;
iconHeader.writeUInt16LE(1, 10); iconHeader.writeUInt16LE(32, 12);
iconHeader.writeUInt32LE(iconPng.length, 14); iconHeader.writeUInt32LE(22, 18);
const assets = { '/social-preview.png': preview, '/favicon.ico': Buffer.concat([iconHeader, iconPng]) };
const check = (values: Record<string,string>, fetcher: typeof fetch) => smokeRelease(values, fetcher, assets);
const config = makeSiteConfig({ origin: env.SMOKE_ORIGIN });
const headers = { 'content-type': 'text/html', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'strict-origin-when-cross-origin', 'permissions-policy': 'camera=(self), microphone=(), geolocation=()', 'content-security-policy': "base-uri 'self'; object-src 'none'; frame-ancestors 'none'; upgrade-insecure-requests" };
const html = (path = '/', site = config) => {
  const metadata = pageMetadata(path, site);
  const body = ({ '/': 'Sign In', '/privacy': 'Privacy policy Account, goals, and food diary', '/terms': 'Terms and conditions Nutrition and health limitations' } as Record<string,string>)[path] ?? 'Private sign-in boundary';
  return new Response(`<html><head><title data-rh="true">${metadata.title}</title><meta name="description" content="${metadata.description}"><meta name="robots" content="${metadata.robots}">${metadata.canonical ? `<link rel="canonical" href="${metadata.canonical}"><meta property="og:image" content="${metadata.socialImage}">` : ''}</head><body>${body}</body></html>`, { headers });
};
const fake = async (url: string | URL | Request, site = config) => {
  const path = new URL(String(url)).pathname;
  if (String(url).startsWith('http:')) return new Response('', { status: 308, headers: { location: `${env.SMOKE_ORIGIN}/` } });
  if (path === '/robots.txt') return new Response(crawlerFiles(site).robots, { headers: { 'content-type': 'text/plain' } });
  if (path === '/sitemap.xml') return new Response(crawlerFiles(site).sitemap, { headers: { 'content-type': 'application/xml' } });
  if (path === '/favicon.ico') return new Response(assets['/favicon.ico'], { headers: { 'content-type': 'image/x-icon' } });
  if (path === '/social-preview.png') {
    return new Response(preview, { headers: { 'content-type': 'image/png' } });
  }
  if (path === '/release.json') return Response.json({ sha: env.GITHUB_SHA });
  if (path.startsWith('/__missing')) return new Response('', { status: 404 });
  if (path.startsWith('/functions/')) return new Response('', { status: 401 });
  if (path === '/auth/v1/settings') return Response.json({});
  return html(path, site);
};
describe('read-only deployment smoke', () => {
  it('checks a candidate using its configured live canonical origin and approved public-only sitemap', async () => {
    const reviewed = { ...env, EXPO_PUBLIC_SITE_ORIGIN: 'https://trackbing.vercel.app', EXPO_PUBLIC_LEGAL_OPERATOR: 'Fixture operator', EXPO_PUBLIC_PRIVACY_EMAIL: 'privacy@trackbing.test', EXPO_PUBLIC_LEGAL_REVIEWED: 'true' };
    const site = makeSiteConfig({ origin: reviewed.EXPO_PUBLIC_SITE_ORIGIN, operator: reviewed.EXPO_PUBLIC_LEGAL_OPERATOR, privacyEmail: reviewed.EXPO_PUBLIC_PRIVACY_EMAIL, legalReviewed: reviewed.EXPO_PUBLIC_LEGAL_REVIEWED });
    await expect(check(reviewed, url => fake(url, site))).resolves.toMatchObject({ crawlers: true, httpsRedirect: true });
  });
  it('checks public pages, exact SHA, actual 404 and API auth without a paid request or user mutation', async () => {
    const calls: { url: string; options?: RequestInit }[] = [];
    const result = await check(env, async (url, options) => { calls.push({ url: String(url), options }); return fake(url); });
    expect(result.publicRoutes).toEqual(['/', '/privacy', '/terms']);
    expect(calls.filter(call => call.options?.method === 'POST').every(call => call.options?.body === '{}')).toBe(true);
    for (const call of calls) {
      expect(call.options?.redirect).toBe('manual');
      const bypass = (call.options?.headers as Record<string, string>)['x-vercel-protection-bypass'];
      expect(bypass).toBe(call.url.startsWith(env.SMOKE_ORIGIN) ? 'fixture-bypass' : undefined);
    }
  });
  it.each(['/privacy', '/terms', '/release.json', '/__missing', '/auth/v1/settings', '/functions/v1/bee-chat'])('fails rather than promote when %s is wrong', async path => {
    await expect(check(env, async url => String(url).includes(path) ? new Response('', { status: path === '/auth/v1/settings' ? 401 : 200 }) : fake(url))).rejects.toThrow();
  });
  it('rejects an unrelated release or missing security headers', async () => {
    await expect(check(env, async url => String(url).endsWith('/release.json') ? Response.json({ sha: 'b'.repeat(40) }) : fake(url))).rejects.toThrow('tested commit');
    await expect(check(env, async () => new Response('fixture', { headers: { 'content-type': 'text/html' } }))).rejects.toThrow('headers');
  });
  it('rejects oversized manifest bodies before storing any response text', async () => {
    await expect(check(env, async url => String(url).endsWith('/release.json') ? new Response('x'.repeat(1025)) : fake(url))).rejects.toThrow('too large');
  });
  it('does not follow a redirect with the deployment bypass token', async () => {
    let calls = 0;
    await expect(check(env, async () => { calls++; return new Response('', { status: 302, headers: { Location: 'https://attacker.tld' } }); })).rejects.toThrow();
    expect(calls).toBe(1);
  });
  it('fails on provider/network timeouts without inventing success', async () => {
    await expect(check(env, async () => { throw new DOMException('fixture secret text', 'TimeoutError'); })).rejects.toThrow();
  });
  it('rejects a successful app shell served at a legal URL', async () => {
    await expect(check(env, async url => String(url).endsWith('/privacy') ? html('/') : fake(url))).rejects.toThrow('content');
  });
  it('rejects a private route without noindex even when public pages pass', async () => {
    await expect(check(env, async url => String(url).endsWith('/profile') ? new Response((await html('/profile').text()).replace('noindex,nofollow','index,follow'), { headers }) : fake(url))).rejects.toThrow('noindex');
  });
  it.each(['/robots.txt', '/sitemap.xml'])('rejects crawler files that expose private pages or contradict draft indexing: %s', async path => {
    await expect(check(env, async url => String(url).endsWith(path) ? new Response(path.endsWith('.xml') ? '<urlset><loc>https://trackbing-candidate.vercel.app/profile</loc></urlset>' : 'User-agent: *\nAllow: /\n') : fake(url))).rejects.toThrow('crawler');
  });
  it('rejects an incorrect social image and an HTML favicon fallback', async () => {
    for (const path of ['/social-preview.png', '/favicon.ico']) await expect(check(env, async url => String(url).endsWith(path) ? html() : fake(url))).rejects.toThrow('asset');
  });
  it('does not send bypass credentials over HTTP or follow a redirect to another site', async () => {
    const calls: RequestInit[] = [];
    await expect(check(env, async (url, options) => {
      if (String(url).startsWith('http:')) { calls.push(options!); return new Response('', { status: 308, headers: { location: 'https://attacker.tld' } }); }
      return fake(url);
    })).rejects.toThrow('HTTPS');
    expect(calls).toHaveLength(1);
    expect(calls[0].headers).toEqual({});
    expect(calls[0].redirect).toBe('manual');
  });
  it('bounds page bodies instead of accepting unbounded server data', async () => {
    await expect(check(env, async url => String(url).endsWith('/privacy') ? new Response('x'.repeat(1024*1024+1), { headers }) : fake(url))).rejects.toThrow('too large');
  });
  it('rejects commented, scripted, body-only and conflicting private indexing metadata', async () => {
    const tag = '<meta name="robots" content="noindex,nofollow">';
    for (const forged of [
      `<html><head><!-- ${tag} --><meta name="robots" content="index,follow"></head></html>`,
      `<html><head><script>${tag}</script></head></html>`,
      `<html><head></head><body>${tag}</body></html>`,
      `<html><head>${tag}<meta name="robots" content="index,follow"></head></html>`,
    ]) await expect(check(env, async url => String(url).endsWith('/profile') ? new Response(forged, { headers }) : fake(url))).rejects.toThrow('noindex');
  });
  it('rejects truncated headers and mutated images with valid dimensions', async () => {
    for (const [path, bytes] of Object.entries(assets)) {
      const mutated = Buffer.from(bytes); mutated[mutated.length - 1] ^= 1;
      for (const data of [bytes.subarray(0, path.endsWith('.png') ? 24 : 6), mutated]) {
        await expect(check(env, async url => String(url).endsWith(path) ? new Response(data, { headers: { 'content-type': path.endsWith('.png') ? 'image/png' : 'image/x-icon' } }) : fake(url))).rejects.toThrow('asset');
      }
    }
  });
});
