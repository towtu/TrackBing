import { writeFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { httpsOrigin, assertPublicKey } from './release.mjs';

async function manifestJson(response) {
  if (!response.body) throw new Error('Missing release identity.');
  const reader = response.body.getReader();
  let text = '';
  let bytes = 0;
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > 1024) throw new Error('Release identity is too large.');
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally { await reader.cancel(); }
}

/** Read-only release probes. No signed-in account, prompts, or paid provider calls. */
export async function smokeRelease(env, fetcher = fetch) {
  const origin = httpsOrigin(env.SMOKE_ORIGIN);
  const supabase = httpsOrigin(env.EXPO_PUBLIC_SUPABASE_URL);
  if (!/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? '')) throw new Error('Smoke checks require a full commit SHA.');
  assertPublicKey(env.EXPO_PUBLIC_SUPABASE_ANON_KEY);
  const pages = ['/', '/privacy', '/terms'];
  const checked = [];
  const headers = env.VERCEL_AUTOMATION_BYPASS_SECRET ? { 'x-vercel-protection-bypass': env.VERCEL_AUTOMATION_BYPASS_SECRET } : {};
  const get = (base, path, requestHeaders = {}) => fetcher(`${base}${path}`, { method: 'GET', headers: requestHeaders, redirect: 'manual', signal: AbortSignal.timeout(15_000) });
  for (const path of pages) {
    const response = await get(origin, path, headers);
    if (response.status !== 200 || !response.headers.get('content-type')?.includes('text/html')) throw new Error(`Public route smoke failed: ${path}.`);
    if (response.headers.get('x-content-type-options') !== 'nosniff' || !response.headers.get('content-security-policy')?.includes("frame-ancestors 'none'")) throw new Error('Release security headers are missing.');
    checked.push(path);
    await response.body?.cancel();
  }
  const manifest = await get(origin, '/release.json', headers);
  // Bounds the only response body read; never write returned text to reports.
  if (manifest.status !== 200 || (await manifestJson(manifest)).sha !== env.GITHUB_SHA) throw new Error('The site is not serving this tested commit.');
  const missing = await get(origin, `/__missing_trackbing_${env.GITHUB_SHA}/`, headers);
  await missing.body?.cancel();
  if (missing.status !== 404) throw new Error('Unknown routes must return HTTP 404.');
  const settings = await get(supabase, '/auth/v1/settings', { apikey: env.EXPO_PUBLIC_SUPABASE_ANON_KEY });
  await settings.body?.cancel();
  if (settings.status !== 200) throw new Error('The public client key does not match the deployed Supabase project.');
  for (const name of ['bee-chat', 'ai-food', 'usda-search', 'billing']) {
    const response = await fetcher(`${supabase}/functions/v1/${name}`, { method: 'POST', headers: { apikey: env.EXPO_PUBLIC_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' }, body: '{}', redirect: 'manual', signal: AbortSignal.timeout(15_000) });
    await response.body?.cancel();
    if (response.status !== 401) throw new Error(`Unauthenticated access must be denied: ${name}.`);
  }
  return { sha: env.GITHUB_SHA, origin, publicRoutes: checked, unknownStatus: 404, unauthenticatedStatus: 401 };
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
