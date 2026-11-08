import { createHash } from 'node:crypto';
import { readFileSync, appendFileSync, writeFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';
import { Buffer } from 'node:buffer';
class ReleaseError extends Error {}

export function assertReleaseContext(env) {
  if (env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || env.GITHUB_REF !== 'refs/heads/main' || !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? '')) throw new ReleaseError('Release workflows must be dispatched from main at a full commit SHA.');
  if (!['staging', 'production'].includes(env.RELEASE_ENVIRONMENT)) throw new ReleaseError('Choose staging or production.');
}
function project(value) { return typeof value === 'string' && /^[a-z0-9]{20}$/.test(value); }
function vercelId(value) { return typeof value === 'string' && /^[A-Za-z0-9_]{5,100}$/.test(value); }
export function stagingMarker(env) {
  if (!project(env.STAGING_SUPABASE_PROJECT_REF) || !vercelId(env.STAGING_VERCEL_PROJECT_ID)) throw new ReleaseError('Configure the staging project identities.');
  const identity = createHash('sha256').update(`${env.STAGING_SUPABASE_PROJECT_REF}:${env.STAGING_VERCEL_PROJECT_ID}`).digest('hex').slice(0, 12);
  return `release-staging-${env.GITHUB_SHA}-${identity}`;
}
export function assertProjectMapping(env) {
  if (!project(env.STAGING_SUPABASE_PROJECT_REF) || !project(env.PRODUCTION_SUPABASE_PROJECT_REF) || env.STAGING_SUPABASE_PROJECT_REF === env.PRODUCTION_SUPABASE_PROJECT_REF || !vercelId(env.STAGING_VERCEL_PROJECT_ID) || !vercelId(env.PRODUCTION_VERCEL_PROJECT_ID) || env.STAGING_VERCEL_PROJECT_ID === env.PRODUCTION_VERCEL_PROJECT_ID) throw new ReleaseError('Staging and production must have distinct, explicitly configured Supabase and Vercel projects.');
}
export function httpsOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw new ReleaseError('Configure a real public HTTPS origin.'); }
  // Operator-controlled release URLs only; no user-supplied server fetches.
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(url.hostname) || /(?:^|\.)(?:localhost|local|internal|test|invalid|example)(?:\.|$)/i.test(url.hostname) || /^[\d.]+$/.test(url.hostname)) throw new ReleaseError('Release origins must be public HTTPS domains without credentials, paths or ports.');
  return url.origin;
}
export function assertPublicKey(key, projectRef) {
  if (typeof key !== 'string' || key.length > 4096 || /\s/.test(key)) throw new ReleaseError('Configure the public Supabase anon/publishable key.');
  if (/^sb_publishable_[A-Za-z0-9_-]{20,}$/.test(key)) return;
  try { const claims = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()); if (claims.role === 'anon' && key.split('.').length === 3 && (!projectRef || claims.ref === projectRef)) return; } catch { /* A malformed key is rejected below. */ }
  throw new ReleaseError('Only a public anon/publishable key may enter the web or mobile build.');
}
export function assertReleaseConfig(env) {
  assertReleaseContext(env); assertProjectMapping(env);
  if (env.RELEASE_ENABLED !== 'true') throw new ReleaseError('Enable releases only after configuring the protected GitHub environment.');
  const production = env.RELEASE_ENVIRONMENT === 'production';
  if (env.SUPABASE_PROJECT_REF !== (production ? env.PRODUCTION_SUPABASE_PROJECT_REF : env.STAGING_SUPABASE_PROJECT_REF) || env.VERCEL_PROJECT_ID !== (production ? env.PRODUCTION_VERCEL_PROJECT_ID : env.STAGING_VERCEL_PROJECT_ID)) throw new ReleaseError('The selected environment does not match its registered projects.');
  if (env.EXPO_PUBLIC_SUPABASE_URL !== `https://${env.SUPABASE_PROJECT_REF}.supabase.co`) throw new ReleaseError('The client Supabase URL must match this release project.');
  assertPublicKey(env.EXPO_PUBLIC_SUPABASE_ANON_KEY, env.SUPABASE_PROJECT_REF);
  httpsOrigin(env.EXPO_PUBLIC_SITE_ORIGIN);
  if (!vercelId(env.VERCEL_ORG_ID)) throw new ReleaseError('Configure the Vercel organization ID.');
  if (production && (env.EXPO_PUBLIC_LEGAL_REVIEWED !== 'true' || !env.EXPO_PUBLIC_LEGAL_OPERATOR?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.EXPO_PUBLIC_PRIVACY_EMAIL ?? ''))) throw new ReleaseError('Production needs actual reviewed policy/operator/contact configuration.');
}
async function githubJson(path, env, fetcher) {
  const response = await fetcher(`https://api.github.com/repos/${env.GITHUB_REPOSITORY}/${path}`, { headers: { Authorization: `Bearer ${env.GH_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }, signal: AbortSignal.timeout(15_000), redirect: 'error' });
  if (!response.ok) throw new ReleaseError('Could not verify staging release evidence with GitHub.');
  return response.json();
}
/** Metadata only: never download or execute an artifact from another workflow. */
export async function requireStagingRelease(env, fetcher = fetch) {
  assertReleaseContext(env); assertProjectMapping(env);
  if (env.RELEASE_ENVIRONMENT !== 'production') return;
  if (!/^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPOSITORY ?? '') || !env.GH_TOKEN) throw new ReleaseError('GitHub release evidence configuration is missing.');
  const marker = stagingMarker(env);
  const data = await githubJson(`actions/workflows/release.yml/runs?head_sha=${env.GITHUB_SHA}&event=workflow_dispatch&status=success&per_page=30`, env, fetcher);
  if (!Array.isArray(data.workflow_runs)) throw new ReleaseError('Invalid staging release evidence.');
  for (const run of data.workflow_runs.slice(0, 10)) {
    if (run.head_sha !== env.GITHUB_SHA || run.head_branch !== 'main' || run.conclusion !== 'success' || run.event !== 'workflow_dispatch' || !Number.isSafeInteger(run.id)) continue;
    const artifacts = await githubJson(`actions/runs/${run.id}/artifacts?per_page=100`, env, fetcher);
    if (!Array.isArray(artifacts.artifacts)) throw new ReleaseError('Invalid staging artifact evidence.');
    if (artifacts.artifacts.some(a => a.name === marker && a.expired === false)) return;
  }
  throw new ReleaseError('Release this exact commit successfully to staging first. Missing or expired evidence blocks production.');
}
export function deploymentUrl(output) {
  const url = httpsOrigin(output.trim());
  if (!new URL(url).hostname.endsWith('.vercel.app')) throw new ReleaseError('The CLI did not return a Vercel deployment URL.');
  return url;
}
export function assertNativeConfig(platform, profile, app, eas) {
  if (!['android', 'ios', 'all'].includes(platform) || !['preview', 'production'].includes(profile)) throw new ReleaseError('Invalid native build selection.');
  if (!eas.build?.[profile] || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(app.expo?.extra?.eas?.projectId ?? '')) throw new ReleaseError('Configure the existing EAS project and build profile.');
  const selected = eas.build[profile];
  if (selected.environment !== (profile === 'production' ? 'production' : 'preview') || selected.extends || selected.env || selected.android?.env || selected.ios?.env) throw new ReleaseError('Native profiles must use the selected remote EAS environment without inherited or inline environment overrides.');
  if (['ios', 'all'].includes(platform) && !/^[\w-]+(?:\.[\w-]+)+$/.test(app.expo?.ios?.bundleIdentifier ?? '')) throw new ReleaseError('Set the approved ios.bundleIdentifier in app.json before requesting an iOS build.');
  if (['android', 'all'].includes(platform) && !/^[\w-]+(?:\.[\w-]+)+$/.test(app.expo?.android?.package ?? '')) throw new ReleaseError('Set the approved Android package before requesting a build.');
}
export function stampRelease(env) {
  assertReleaseConfig(env);
  if (!existsSync('.vercel/output/static')) throw new ReleaseError('Build the Vercel candidate before stamping its commit identity.');
  const body = `${JSON.stringify({ sha: env.GITHUB_SHA })}\n`;
  writeFileSync('.vercel/output/static/release.json', body);
  writeFileSync('dist/release.json', body);
}
/** Compare the remote EAS public configuration before paying for a build. */
export function assertNativeEnvironment(source, expected) {
  const actual = parseEnv(source);
  for (const name of ['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_ANON_KEY', 'EXPO_PUBLIC_SITE_ORIGIN', 'EXPO_PUBLIC_LEGAL_OPERATOR', 'EXPO_PUBLIC_PRIVACY_EMAIL', 'EXPO_PUBLIC_LEGAL_REVIEWED']) {
    if ((actual[name] ?? '') !== (expected[name] ?? '')) throw new ReleaseError('Remote EAS public configuration differs from this GitHub environment. Align the selected EAS environment before building.');
  }
  if (actual.EXPO_PUBLIC_ANALYTICS_ENABLED === 'true') throw new ReleaseError('Native analytics requires a separate reviewed implementation; keep it disabled.');
  assertPublicKey(actual.EXPO_PUBLIC_SUPABASE_ANON_KEY, expected.SUPABASE_PROJECT_REF);
}
/** Only a finished, correctly identified binary is a successful native build. */
export function validateNativeBuilds(source, env, app) {
  if (typeof source !== 'string' || source.length > 2 * 1024 * 1024) throw new ReleaseError('Invalid native build results.');
  const data = JSON.parse(source);
  const platforms = env.BUILD_PLATFORM === 'all' ? ['ANDROID', 'IOS'] : [env.BUILD_PLATFORM?.toUpperCase()];
  if (!Array.isArray(data) || data.length !== platforms.length || !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? '')) throw new ReleaseError('Missing completed native build results.');
  const found = new Set();
  const builds = data.map(build => {
    const identifier = build?.platform === 'IOS' ? app.expo?.ios?.bundleIdentifier : app.expo?.android?.package;
    if (!build || build.status !== 'FINISHED' || !platforms.includes(build.platform) || found.has(build.platform) || build.gitCommitHash !== env.GITHUB_SHA || build.buildProfile !== env.BUILD_PROFILE || build.app?.id !== app.expo?.extra?.eas?.projectId || build.appIdentifier !== identifier || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(build.id ?? '')) throw new ReleaseError('Native build was cancelled, unfinished, or belongs to another commit/profile/project.');
    found.add(build.platform);
    // Keep actor metadata, provider logs and signed artifact links out of reports.
    return { id: build.id, platform: build.platform, status: 'FINISHED' };
  });
  return { schemaVersion: 1, sha: env.GITHUB_SHA, profile: env.BUILD_PROFILE, builds };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const command = process.argv[2];
    if (command === 'context') { assertReleaseContext(process.env); assertProjectMapping(process.env); await requireStagingRelease(process.env); }
    else if (command === 'config') { assertReleaseConfig(process.env); if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `marker=${stagingMarker(process.env)}\n`); }
    else if (command === 'url') { const url = deploymentUrl(readFileSync('output/release/deployment-url.txt', 'utf8')); appendFileSync(process.env.GITHUB_OUTPUT, `url=${url}\n`); }
    else if (command === 'native-env') assertNativeEnvironment(readFileSync('output/native-build/eas.env', 'utf8'), process.env);
    else if (command === 'stamp') stampRelease(process.env);
    else if (command === 'native-result') writeFileSync('output/native-build/result.json', `${JSON.stringify(validateNativeBuilds(readFileSync('output/native-build/raw-result.json', 'utf8'), process.env, JSON.parse(readFileSync('app.json'))), null, 2)}\n`);
    else if (command === 'native') assertNativeConfig(process.env.BUILD_PLATFORM, process.env.BUILD_PROFILE, JSON.parse(readFileSync('app.json')), JSON.parse(readFileSync('eas.json')));
    else throw new ReleaseError('Choose a supported release validation command.');
    console.log('Release validation passed.');
  } catch (error) { console.error(error instanceof ReleaseError ? error.message : 'Release verification failed. Check configuration and provider availability; no release was approved.'); process.exitCode = 1; }
}
