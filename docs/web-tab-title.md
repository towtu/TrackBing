# Browser tab title hotfix

The published `main` page returned an empty `<title>`. Its layout only set a
navigation-screen title, which does not supply Expo Router's web metadata.
The layout now renders `expo-router/head` with **TrackBing** and a short
description during auth loading, signed-out and signed-in rendering. This uses
the [Head metadata support for SDK 57 and earlier](https://docs.expo.dev/router/web/static-rendering/#meta-tags);
TrackBing remains on SDK 54. No native screen layout or database changes.

## Build and release

Vercel's checked-in build command now runs `npm run vercel-build`. It exports
web with a cleared Metro cache, then runs `scripts/check-web-title.mjs`. The
check rejects missing, empty, unbranded or duplicate titles in application HTML.
Expo-generated `_sitemap` and `+not-found` utility pages are outside this check.
Existing rewrites and the favicon are preserved.

```sh
npm ci
npm run typecheck
npm test
npm run lint
npm run vercel-build
```

Use the existing public Supabase environment configuration for a real deployment.
No new secret or variable is needed. Controlled local verification used a fake
public Supabase origin/key with intercepted requests; that test export must not
be deployed. Rebuild from the approved commit and actual hosting configuration.
After deployment, verify the live HTML title and the browser tab while signed
out, after sign-in, on a protected deep link and after reload.

## Verification and limits

The title check first failed against the actual public HTML. The corrected
export has branded titles in all 15 application pages. Typecheck, lint and
132 tests pass. Browser checks at 375/768/1440 cover initial HTML without
JavaScript, hydration, reload and protected signed-out routes; authenticated
checks use controlled fixtures. No real account or food history was changed.

The unchanged `main` dependency lock currently reports critical `shell-quote`
and `tar` advisories (`npm audit --omit=dev`, 8 November 2026). The dependency
audit remains a release blocker; a passing title check does not clear it.
No production deployment or merge is claimed by this local verification.
Recovery is to revert this focused hotfix and rebuild; no data rollback.
