# Hosting connection — 19 October 2026

**Configuration applied; no deployment.** The existing Vercel login and project
were verified. Production and staging releases remain explicitly disabled.
This supplement updates the setup status in the
[18 October launch report](2026-10-18-release-readiness.md); its application,
database, provider and device verification boundaries still apply.

## Verified destination

| Setting | Existing production value |
| --- | --- |
| Repository | `towtu/TrackBing` |
| Vercel project | `track-bing` |
| Vercel project ID | `prj_D6UptATMxSeBJDYLVQdQHtD6h4Z7` |
| Vercel organization ID | `team_hMZmIZIpJudrZMUkdHL3JgVc` |
| Vercel scope | `towtus-projects` |
| Public origin | `https://track-bing.vercel.app` |
| Supabase project reference | `dnplpaoxgpajbbunscdg` |

These identifiers and the Supabase anon key are public configuration. Provider,
service-role and deployment credentials must remain server/environment secrets.

## Applied changes

- Linked the checkout to the existing Vercel project using CLI 62.2.0. Local
  `.vercel/project.json` remains ignored. Removed the CLI's redundant ignore
  additions and generated local OIDC block; `.env.local` was restored byte for
  byte to its pre-link contents. Unrelated `codex.diff` remains unchanged.
- Set Vercel's future build command to `npm run build:web` and output directory
  to `dist`, matching `vercel.json`. Retained Node 24.x and the existing Git link;
  no deploy hooks were present. The branch's `git.deploymentEnabled=false`
  remains in place; it is not a claim about configuration on unmerged `main`.
- Removed the unused public USDA key variable from Vercel's production,
  preview and development targets. The existing Supabase `USDA_API_KEY` was
  neither read nor changed. Current source and `origin/main` use the server
  proxy, without a client reference to that public build variable.
- Removed whitespace around Vercel's public Supabase URL; its URL and anon key
  now exactly match the validated local/GitHub production configuration.
- Added Vercel Production public values: real `EXPO_PUBLIC_SITE_ORIGIN`,
  `EXPO_PUBLIC_LEGAL_REVIEWED=false` and `EXPO_PUBLIC_ANALYTICS_ENABLED=false`.
- Added repository variables `PRODUCTION_SUPABASE_PROJECT_REF` and
  `PRODUCTION_VERCEL_PROJECT_ID` using the identities above.
- Added GitHub **Production** environment variables: `SUPABASE_PROJECT_REF`,
  `VERCEL_PROJECT_ID`, `VERCEL_ORG_ID`, `EXPO_PUBLIC_SUPABASE_URL`,
  `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_SITE_ORIGIN`,
  `EXPO_PUBLIC_LEGAL_REVIEWED=false`, `EXPO_PUBLIC_ANALYTICS_ENABLED=false`,
  and `RELEASE_ENABLED=false`. The anon JWT's role and project were checked;
  the key value was not printed.
- Set GitHub **staging** `RELEASE_ENABLED=false`. No staging project identities,
  legal operator/contact, provider approvals or paid resources were invented.

Project/variable changes affect future builds; they do not publish the branch,
apply migrations, move domains or change customer records. No new migration or
application dependency was needed for this setup increment.

## Security finding and verification boundary

The USDA value had been configured as an Expo public build variable. Public
Expo values can enter client bundles; encrypting them in the hosting dashboard
does not keep them secret after compilation. See
[Expo environment variables](https://docs.expo.dev/guides/environment-variables/).

An exact-value check, performed in memory without printing the value, found no
match in the three JavaScript files loaded by the existing live homepage
(8,844,621 bytes; zero download failures). This does **not** audit lazy-loaded
files, earlier deployments or Git history. Exposure is not established or
ruled out. Consider rotating the USDA credential as a precaution; any replacement
belongs only in Supabase's server secrets. Removing a build variable does not
erase already deployed assets or revoke a credential.

Remote settings were read back after writes. The public anon key was accepted
by Supabase's Auth settings endpoint (HTTP 200), without reading private user
records. Redacted setup evidence is under ignored `output/release/setup/`.
No provider key, CLI login token or generated OIDC token was copied into GitHub.

The fresh dependency gate still fails: `npm run ci:audit` reports zero critical
or moderate findings and 24 affected high packages, then rejects the expired
`braces` exception. No exception was extended. npm's latest published versions
remain `braces` 3.0.3 and `node-forge` 1.4.0 at this check. See the
[dependency remediation record](../dependency-remediation.md).

## Next operator step: Vercel CI token

The CLI login works locally. The bounded attempt to create a 90-day,
project-scoped automation token through that login did not succeed.
GitHub **Production** still has no deployment secrets. Local login credentials
were not repurposed for CI.

1. Open [Vercel Account Tokens](https://vercel.com/account/tokens).
2. Create `TrackBing production CI`, scoped to the **track-bing project** in
   **towtus-projects**, with an expiration such as 90 days. Use the narrowest
   available scope; do not select full-account access for this project.
3. Run this command in an authenticated local terminal, then paste the token
   into its hidden prompt. Do not paste it into chat, a command argument or a
   tracked file:

   ```sh
   gh secret set VERCEL_TOKEN --repo towtu/TrackBing --env Production
   ```

The provider documents project scope and token creation in its
[access-token guide](https://vercel.com/kb/guide/how-do-i-use-a-vercel-api-access-token).
GitHub CLI [encrypts the secret locally before upload](https://cli.github.com/manual/gh_secret_set).
An encrypted secret's existence establishes configuration, not a successful
deployment; verify its intended project access without deploying first.

After this credential step, staging projects, protected Supabase deployment
credentials, legal/provider review, the dependency fixes and the live/native
walkthrough still remain. Follow [CI and release setup](../CI_CD.md) in that
order. Leave `RELEASE_ENABLED=false` until the complete gates pass.

## Checks for this increment

- Remote project/variable read-back and public Auth-settings probe passed.
- Release, audit, secret-scanner and workflow-policy tests: 157 passed in 4 files.
- `npm run ci:audit` failed on the expired security exception as described above.
- Application/browser/backend checks from the previous commit remain historical;
  this setup increment changes no application or database code.

## Recovery

Keep release flags false while correcting configuration. The preceding Vercel
build/output overrides were unset (`null`); a redacted snapshot is retained in
`output/release/setup/vercel-settings-before.json`. If intentionally reverting
those overrides, restore them through project settings; do not delete the
project or customer data. Public production mappings can be edited/deleted in
GitHub/Vercel settings without a database rollback. Do not restore the public
USDA secret or ephemeral OIDC block. Revoke/replace an automation token through
Vercel and update its encrypted GitHub secret before its expiration.
