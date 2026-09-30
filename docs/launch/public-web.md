# Public routes and web release controls

Implemented locally on 27 September 2026; no production deployment or legal
approval is implied. The rest of the launch checklist is recorded separately.

## Routes and authentication

`/` and `/auth` export real sign-in content, rather than an authentication-loading
spinner. `/privacy` and `/terms` open directly while signed out and on native
clients. The root stack stays mounted so legal links also work from onboarding.
Its screen wrapper prevents private components from mounting without a session.
Account changes remount the stack and Bee by owner. Private route exports contain
no account records and have `noindex,nofollow`; the signed-in dashboard changes
its runtime metadata to noindex too. RLS and server authentication remain the data
security boundary.

The legal copy inventories actual account/goal/weight-history/diary/personal-food/recipe records and private generated dashboard insights,
camera/barcode processing, local session/cache storage, Supabase, USDA, Open Food
Facts, the existing GitHub food list, Vercel, Gemini, Google Search, and optional
Plausible analytics. It describes the implemented 30-day/50-message chat limit,
explicit preferences and clear controls, and the transient display-only Google
answer policy. It does not promise in-app account deletion or uploaded-label OCR.

Both policies visibly remain **operator-review drafts**. Required decisions:
legal operator, a verified support/privacy contact, age eligibility, legal basis
and rights process, account deletion and backups/log retention, service/payment
terms if applicable, governing law/disputes, regional processing, Google paid
billing/data-use configuration, and analytics account/retention approval. Publish
reviewed copy and an effective date before enabling public indexing.

## Safe public configuration

Use the safe root `.env.example`; real local environment files remain ignored.

| Variable | Purpose |
| --- | --- |
| `EXPO_PUBLIC_SITE_ORIGIN` | Real production HTTPS origin, without path, query, credentials, or port. Missing/unsafe/placeholder origins omit canonical/social URLs. |
| `EXPO_PUBLIC_LEGAL_OPERATOR` | Operator's approved public legal name. No invented default. |
| `EXPO_PUBLIC_PRIVACY_EMAIL` | Operator's approved public contact. Invalid contacts are omitted. |
| `EXPO_PUBLIC_LEGAL_REVIEWED` | Set `true` only after reviewed copy and operator details are complete. Does not itself perform legal review. |

No API secret belongs in any `EXPO_PUBLIC_*` value. Gemini, USDA, and Supabase
service-role credentials stay in Edge Function secrets as described in
[Bee deployment](../bee-gemini-deployment.md).

Metadata uses Expo Router `Head` in the static render. The same pure configuration
module controls client metadata and the post-export files. Without a valid real
origin and reviewed legal configuration, robots deny indexing and the sitemap is
empty. Once approved/configured, the sitemap contains only `/`, `/privacy`, and
`/terms`; private pages, duplicate auth/group paths, and Expo's internal sitemap
are excluded. The branded 1200×630 `public/social-preview.png` uses existing Bee
art and is 127,530 bytes; its dimensions are checked in the release build.

## Build, routing, and headers

`npm run build:web` / Vercel's build run the Expo web export followed by
`scripts/finalize-web-export.mjs`. The finalizer checks real public HTML content,
titles/descriptions, private noindex metadata, exported internal anchors, the
social asset and favicon; it emits crawler files and copies `+not-found.html` to
`404.html`. Expo's existing favicon/native icon configuration is preserved.

Vercel now uses clean static URLs with **no blanket index rewrite**. A known
route resolves its own HTML; an unmatched path should receive the branded
`404.html` and HTTP 404. Configured headers cover nosniff, frame restrictions,
referrer policy, a compatible minimal CSP, and same-origin camera permission.
Microphone/geolocation are disabled. HSTS is deliberately pending real-domain
TLS/HTTP-redirect verification; local files do not establish those guarantees.

Operator deployment verification, after authorized staging/production rollout:

1. Set the real origin and approved operator/contact data in build configuration.
2. Check `http://<real-domain>` redirects to HTTPS, certificate coverage, all
   security headers, scanner permissions, and asset loading; then decide HSTS.
3. Request `/privacy`, `/terms`, `/profile`, `/robots.txt`, `/sitemap.xml`,
   `/social-preview.png`, and a unique unknown URL. Confirm private session
   protection, correct content, and actual unknown-route HTTP 404.
4. Inspect social previews on the real domain; run mobile/desktop Lighthouse and
   native deep-link/VoiceOver/TalkBack walks. Local export cannot verify these.

## Item evidence (this slice)

| Item | Initial | Local result | Remaining action |
| --- | --- | --- | --- |
| 1 Privacy | Missing | Public/native route and processor/control draft implemented; export content checked. | Real operator, contact, retention/deletion/rights decisions and legal sign-off; native runtime walk. |
| 2 Terms | Missing | Public/native route and nutrition limitations draft implemented; export content checked. | Approved operator terms/age/dispute decisions/effective date; native runtime walk. |
| 4 HTTPS | Deployment-dependent | All new external configuration is HTTPS-only; compatible Vercel headers implemented. | Real-domain TLS/redirect/header/camera checks, then HSTS decision. |
| 6 Metadata | Missing | Public static titles/descriptions and private noindex verified by finalizer. | Check reviewed-origin production HTML after deployment. |
| 7 Social preview | Missing | Branded PNG and configured-origin OG/Twitter metadata implemented; visual inspection/dimensions verified. | Real production origin and deployed social-preview check. |
| 8 Favicon | Existing partial | Existing Expo favicon/icon preserved; exported favicon file verified. | Browser/native store icon runtime and deployed file checks. |
| 9 Crawlers | Missing | Public-only conditional sitemap/robots implemented; unsafe origins/draft deny indexing. | Real origin/reviewed policies and deployed file checks. |
| 15 404 | Missing/incorrect | Branded route, emitted `404.html`, removed wildcard200 rewrite. | Known/unknown URLs with actual HTTP status on Vercel. |
| 16 Links | Partial | Release build checks every exported internal anchor; legal/contact links are validated. | Manual provider/source/support external links and native deep-link checks. |

Verification: 23 deterministic public configuration/route tests passed; real Expo
web export and finalizer passed. Real Chrome checks on an isolated static server verified privacy, terms, and
custom not-found at 375/768/1440 px with no horizontal overflow, correct titles
and headings, and working legal/back links. Keyboard Tab focused the back link
with a visible outline. Evidence/screenshots are in
`output/playwright/launch-public/`. There were no JavaScript exceptions or failed
requests; the three unknown-route document404 console entries were expected. A
previous duplicate Supabase-client warning was reported and fixed in Auth, with
final whole-app verification still required. This local server does not establish
Vercel's HTTP status, HTTPS, or native runtime behavior.

Primary documentation checked 27 September 2026:

- [Expo static rendering, Head and public assets](https://docs.expo.dev/router/web/static-rendering/)
- [React Navigation screen wrapper](https://reactnavigation.org/docs/navigator/#screen-layout)
- [Vercel custom static 404](https://vercel.com/kb/guide/custom-404-page)
- [Vercel clean URLs and headers](https://vercel.com/docs/project-configuration/vercel-json)
- [Google grounding use and retention terms](https://ai.google.dev/gemini-api/terms)
- [Plausible data policy](https://plausible.io/data-policy)
