import { describe, expect, it } from 'vitest';
import { smokeRelease } from './smoke.mjs';
const env = { SMOKE_ORIGIN: 'https://trackbing-candidate.vercel.app', EXPO_PUBLIC_SUPABASE_URL: 'https://aaaaaaaaaaaaaaaaaaaa.supabase.co', EXPO_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_abcdefghijklmnopqrstuv', GITHUB_SHA: 'a'.repeat(40), VERCEL_AUTOMATION_BYPASS_SECRET: 'fixture-bypass' };
const html = () => new Response('<html>fixture</html>', { headers: { 'content-type': 'text/html', 'x-content-type-options': 'nosniff', 'content-security-policy': "frame-ancestors 'none'" } });
const fake = async (url: string | URL | Request) => {
  const path = new URL(String(url)).pathname;
  if (path === '/release.json') return Response.json({ sha: env.GITHUB_SHA });
  if (path.startsWith('/__missing')) return new Response('', { status: 404 });
  if (path.startsWith('/functions/')) return new Response('', { status: 401 });
  if (path === '/auth/v1/settings') return Response.json({});
  return html();
};
describe('read-only deployment smoke', () => {
  it('checks public pages, exact SHA, actual 404 and API auth without a paid request or user mutation', async () => {
    const calls: { url: string; options?: RequestInit }[] = [];
    const result = await smokeRelease(env, async (url, options) => { calls.push({ url: String(url), options }); return fake(url); });
    expect(result.publicRoutes).toEqual(['/', '/privacy', '/terms']);
    expect(calls.filter(call => call.options?.method === 'POST').every(call => call.options?.body === '{}')).toBe(true);
    for (const call of calls) {
      expect(call.options?.redirect).toBe('manual');
      const bypass = (call.options?.headers as Record<string, string>)['x-vercel-protection-bypass'];
      expect(bypass).toBe(call.url.startsWith(env.SMOKE_ORIGIN) ? 'fixture-bypass' : undefined);
    }
  });
  it.each(['/privacy', '/terms', '/release.json', '/__missing', '/auth/v1/settings', '/functions/v1/bee-chat'])('fails rather than promote when %s is wrong', async path => {
    await expect(smokeRelease(env, async url => String(url).includes(path) ? new Response('', { status: path === '/auth/v1/settings' ? 401 : 200 }) : fake(url))).rejects.toThrow();
  });
  it('rejects an unrelated release or missing security headers', async () => {
    await expect(smokeRelease(env, async url => String(url).endsWith('/release.json') ? Response.json({ sha: 'b'.repeat(40) }) : fake(url))).rejects.toThrow('tested commit');
    await expect(smokeRelease(env, async () => new Response('fixture', { headers: { 'content-type': 'text/html' } }))).rejects.toThrow('headers');
  });
  it('rejects oversized manifest bodies before storing any response text', async () => {
    await expect(smokeRelease(env, async url => String(url).endsWith('/release.json') ? new Response('x'.repeat(1025)) : fake(url))).rejects.toThrow('too large');
  });
  it('does not follow a redirect with the deployment bypass token', async () => {
    let calls = 0;
    await expect(smokeRelease(env, async () => { calls++; return new Response('', { status: 302, headers: { Location: 'https://attacker.tld' } }); })).rejects.toThrow();
    expect(calls).toBe(1);
  });
  it('fails on provider/network timeouts without inventing success', async () => {
    await expect(smokeRelease(env, async () => { throw new DOMException('fixture secret text', 'TimeoutError'); })).rejects.toThrow();
  });
});
