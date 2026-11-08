import { describe, expect, it } from 'vitest';
import { assertNativeConfig, assertNativeEnvironment, assertProjectMapping, assertPublicKey, assertReleaseConfig, assertReleaseContext, deploymentUrl, httpsOrigin, requireStagingRelease, stagingMarker, validateNativeBuilds } from './release.mjs';

const sha = 'a'.repeat(40);
const publicKey = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role: 'anon', ref: 'a'.repeat(20) })).toString('base64url')}.signature`;
const config = {
  GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main', GITHUB_SHA: sha,
  RELEASE_ENVIRONMENT: 'staging', RELEASE_ENABLED: 'true', GITHUB_REPOSITORY: 'towtu/TrackBing', GH_TOKEN: 'fixture-token',
  STAGING_SUPABASE_PROJECT_REF: 'a'.repeat(20), PRODUCTION_SUPABASE_PROJECT_REF: 'b'.repeat(20),
  STAGING_VERCEL_PROJECT_ID: 'prj_staging', PRODUCTION_VERCEL_PROJECT_ID: 'prj_production',
  SUPABASE_PROJECT_REF: 'a'.repeat(20), VERCEL_PROJECT_ID: 'prj_staging', VERCEL_ORG_ID: 'team_trackbing',
  EXPO_PUBLIC_SUPABASE_URL: `https://${'a'.repeat(20)}.supabase.co`, EXPO_PUBLIC_SUPABASE_ANON_KEY: publicKey,
  EXPO_PUBLIC_SITE_ORIGIN: 'https://trackbing-staging.vercel.app', EXPO_PUBLIC_LEGAL_REVIEWED: 'false', EXPO_PUBLIC_LEGAL_OPERATOR: '', EXPO_PUBLIC_PRIVACY_EMAIL: '',
};
const production = { ...config, RELEASE_ENVIRONMENT: 'production', SUPABASE_PROJECT_REF: config.PRODUCTION_SUPABASE_PROJECT_REF, VERCEL_PROJECT_ID: config.PRODUCTION_VERCEL_PROJECT_ID, EXPO_PUBLIC_SUPABASE_URL: `https://${config.PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co`, EXPO_PUBLIC_SUPABASE_ANON_KEY: publicKey.replace(publicKey.split('.')[1], Buffer.from(JSON.stringify({ role: 'anon', ref: 'b'.repeat(20) })).toString('base64url')), EXPO_PUBLIC_LEGAL_REVIEWED: 'true', EXPO_PUBLIC_LEGAL_OPERATOR: 'Fixture operator', EXPO_PUBLIC_PRIVACY_EMAIL: 'privacy@trackbing.test' };

describe('release boundaries', () => {
  it('accepts a configured staging release without pretending draft policies are approved', () => expect(() => assertReleaseConfig(config)).not.toThrow());
  it.each([{ GITHUB_REF: 'refs/heads/feature' }, { GITHUB_EVENT_NAME: 'pull_request' }, { GITHUB_SHA: 'main' }, { RELEASE_ENVIRONMENT: 'preview' }])('rejects untrusted context %o', change => expect(() => assertReleaseContext({ ...config, ...change })).toThrow());
  it('requires distinct registered projects', () => expect(() => assertProjectMapping({ ...config, PRODUCTION_SUPABASE_PROJECT_REF: config.STAGING_SUPABASE_PROJECT_REF })).toThrow());
  it.each([{ RELEASE_ENABLED: '' }, { SUPABASE_PROJECT_REF: config.PRODUCTION_SUPABASE_PROJECT_REF }, { VERCEL_PROJECT_ID: config.PRODUCTION_VERCEL_PROJECT_ID }, { EXPO_PUBLIC_SUPABASE_URL: production.EXPO_PUBLIC_SUPABASE_URL }])('rejects mismapped environment %o', change => expect(() => assertReleaseConfig({ ...config, ...change })).toThrow());
  it('blocks production with unreviewed policies', () => expect(() => assertReleaseConfig({ ...production, EXPO_PUBLIC_LEGAL_REVIEWED: 'false' })).toThrow());
  it('rejects a legacy public key for a different project', () => expect(() => assertReleaseConfig({ ...production, EXPO_PUBLIC_SUPABASE_ANON_KEY: publicKey })).toThrow());
  it('accepts reviewed production configuration', () => expect(() => assertReleaseConfig(production)).not.toThrow());
  it.each(['http://trackbing.vercel.app', 'https://localhost', 'https://127.0.0.1', 'https://x.internal', 'https://example.com', 'https://user:pass@trackbing.vercel.app', 'https://trackbing.vercel.app/path', 'https://trackbing.vercel.app?token=secret'])('rejects unsafe origin %s', value => expect(() => httpsOrigin(value)).toThrow());
  it('rejects secret keys even if named EXPO_PUBLIC', () => {
    const service = publicKey.replace(publicKey.split('.')[1], Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url'));
    for (const key of [service, 'sb_secret_test', 'build-only-placeholder']) expect(() => assertPublicKey(key)).toThrow();
    expect(() => assertPublicKey('sb_publishable_abcdefghijklmnopqrstuv')).not.toThrow();
  });
  it('parses only one actual deployment URL', () => {
    expect(deploymentUrl('https://trackbing-build.vercel.app\n')).toBe('https://trackbing-build.vercel.app');
    expect(() => deploymentUrl('https://trackbing.vercel.app.attacker.tld')).toThrow();
    expect(() => deploymentUrl('Error\nhttps://trackbing.vercel.app')).toThrow();
  });
  it('binds staging proof to commit and registered project identities', () => {
    expect(stagingMarker(config)).not.toBe(stagingMarker({ ...config, GITHUB_SHA: 'b'.repeat(40) }));
    expect(stagingMarker(config)).not.toBe(stagingMarker({ ...config, STAGING_VERCEL_PROJECT_ID: 'prj_other' }));
  });
  it('does not require a previous release for staging', async () => {
    await requireStagingRelease(config, async () => { throw new Error('must not request'); });
  });
  it('accepts only successful main workflow evidence and reads artifact metadata without downloading', async () => {
    const paths: string[] = [];
    const fake = async (url: string | URL | Request, options?: RequestInit) => {
      paths.push(String(url));
      expect(options?.redirect).toBe('error');
      return Response.json(paths.length === 1 ? { workflow_runs: [{ id: 1, head_sha: sha, head_branch: 'main', conclusion: 'success', event: 'workflow_dispatch' }] } : { artifacts: [{ name: stagingMarker(config), expired: false }] });
    };
    await expect(requireStagingRelease(production, fake)).resolves.toBeUndefined();
    expect(paths).toHaveLength(2);
    expect(paths.every(path => !path.includes('/zip'))).toBe(true);
  });
  it.each([{ head_sha: 'b'.repeat(40) }, { head_branch: 'feature' }, { conclusion: 'failure' }, { event: 'pull_request' }])('rejects false proof %o', async change => {
    await expect(requireStagingRelease(production, async () => Response.json({ workflow_runs: [{ id: 1, head_sha: sha, head_branch: 'main', conclusion: 'success', event: 'workflow_dispatch', ...change }] }))).rejects.toThrow('staging first');
  });
  it.each([{ name: 'wrong', expired: false }, { name: stagingMarker(config), expired: true }])('rejects expired or different artifact %o', async artifact => {
    let calls = 0;
    await expect(requireStagingRelease(production, async () => Response.json(++calls === 1 ? { workflow_runs: [{ id: 1, head_sha: sha, head_branch: 'main', conclusion: 'success', event: 'workflow_dispatch' }] } : { artifacts: [artifact] }))).rejects.toThrow('staging first');
  });
  it('fails closed on GitHub failures and invalid responses', async () => {
    await expect(requireStagingRelease(production, async () => new Response('', { status: 403 }))).rejects.toThrow();
    await expect(requireStagingRelease(production, async () => Response.json({ workflow_runs: null }))).rejects.toThrow();
  });
  it('checks effective remote EAS environment and declines unknown native analytics', () => {
    const source = Object.entries(config).filter(([key]) => key.startsWith('EXPO_PUBLIC_')).map(([key,value]) => `${key}=${JSON.stringify(value)}`).join('\n');
    expect(() => assertNativeEnvironment(source, config)).not.toThrow();
    expect(() => assertNativeEnvironment(source.replace(config.EXPO_PUBLIC_SUPABASE_URL, production.EXPO_PUBLIC_SUPABASE_URL), config)).toThrow();
    expect(() => assertNativeEnvironment(`${source}\nEXPO_PUBLIC_ANALYTICS_ENABLED=true`, config)).toThrow();
  });
  it('does not invent an iOS identity or approve unsupported native profiles', () => {
    const app = { expo: { extra: { eas: { projectId: '6ef27348-f0f2-4217-a0d3-b86aa4bdb498' } }, android: { package: 'com.fixture.TrackBing' } } };
    const eas = { build: { preview: { environment: 'preview' } } };
    expect(() => assertNativeConfig('android', 'preview', app, eas)).not.toThrow();
    expect(() => assertNativeConfig('ios', 'preview', app, eas)).toThrow('bundleIdentifier');
    expect(() => assertNativeConfig('android', 'unknown', app, eas)).toThrow();
    for (const change of [{ environment: 'production' }, { env: { EXPO_PUBLIC_SUPABASE_URL: 'different' } }, { extends: 'development' }, { android: { env: {} } }]) {
      expect(() => assertNativeConfig('android', 'preview', app, { build: { preview: { environment: 'preview', ...change } } })).toThrow();
    }
  });
});

describe('completed native builds', () => {
  const app = { expo: { extra: { eas: { projectId: '6ef27348-f0f2-4217-a0d3-b86aa4bdb498' } }, android: { package: 'com.fixture.TrackBing' }, ios: { bundleIdentifier: 'com.fixture.TrackBing' } } };
  const buildEnv = { BUILD_PLATFORM: 'android', BUILD_PROFILE: 'preview', GITHUB_SHA: sha };
  const build = { id: '7ef27348-f0f2-4217-a0d3-b86aa4bdb498', app: { id: app.expo.extra.eas.projectId }, platform: 'ANDROID', status: 'FINISHED', gitCommitHash: sha, buildProfile: 'preview', appIdentifier: 'com.fixture.TrackBing', logFiles: ['fixture-secret'], artifacts: { buildUrl: 'fixture-private-link' }, initiatingActor: { id: 'fixture-person' } };
  it('retains completion evidence without provider logs, actor metadata or signed links', () => {
    const report = validateNativeBuilds(JSON.stringify([build]), buildEnv, app);
    expect(report.builds).toEqual([{ id: build.id, platform: 'ANDROID', status: 'FINISHED' }]);
    expect(JSON.stringify(report)).not.toMatch(/secret|private-link|person|artifacts|logFiles/);
  });
  it.each(['CANCELED', 'PENDING_CANCEL', 'ERRORED', 'IN_QUEUE', 'IN_PROGRESS', undefined])('does not equate CLI exit 0 to a completed %s build', status => expect(() => validateNativeBuilds(JSON.stringify([{ ...build, status }]), buildEnv, app)).toThrow());
  it.each([{ gitCommitHash: 'b'.repeat(40) }, { buildProfile: 'production' }, { platform: 'IOS' }, { app: { id: 'other' } }, { appIdentifier: 'com.other.App' }])('rejects mismatched result %o', change => expect(() => validateNativeBuilds(JSON.stringify([{ ...build, ...change }]), buildEnv, app)).toThrow());
  it('requires both unique platforms when all was requested', () => {
    expect(() => validateNativeBuilds(JSON.stringify([build]), { ...buildEnv, BUILD_PLATFORM: 'all' }, app)).toThrow();
    expect(() => validateNativeBuilds(JSON.stringify([build, build]), { ...buildEnv, BUILD_PLATFORM: 'all' }, app)).toThrow();
    expect(validateNativeBuilds(JSON.stringify([build, { ...build, platform: 'IOS' }]), { ...buildEnv, BUILD_PLATFORM: 'all' }, app).builds).toHaveLength(2);
  });
  it.each(['null', '[null]', '[]', '{', 'x'.repeat(2 * 1024 * 1024 + 1)])('rejects missing/malformed/oversized results', source => expect(() => validateNativeBuilds(source, buildEnv, app)).toThrow());
});
