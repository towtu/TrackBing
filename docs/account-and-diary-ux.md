# Account recovery, diary history and tracking downloads

Implemented locally on `feat/bee-conversation`. These features use no Gemini credit and work on Basic. They preserve the existing food, weight and goal writers.

## User flows

- Sign-in → **Forgot password?**, or Profile → **Change password**. Enter the registered email, request a code, enter that code and the new password twice. Password changes only after Supabase verifies the code. Gmail is an ordinary recipient; TrackBing never asks for a Gmail password or sends mail from the user's Gmail account.
- Dashboard → **History**, or Profile → **Browse food diary**. Browse previous/next days, choose a YYYY-MM-DD date, return to Today or refresh. Read actual owned food entries and totals using the saved account timezone. No historical calorie target is invented and this page performs no food write.
- Profile → **Download your tracking data**. Choose 1–366 days. Download JSON or food/weight CSV. JSON also includes current goals, personal foods/recipes and explicit saved preferences. Dated weights are included; undated legacy baselines, chat, Grounded Results, billing and Auth credentials are excluded.

## Email setup required before releasing recovery

1. In **Supabase Dashboard → Authentication → Email Templates → Reset password**, set the body to [recovery.html](../supabase/templates/recovery.html). Suggested subject: `Your TrackBing password recovery code`. It uses `{{ .Token }}` instead of a single-use URL. Keep the project's email OTP length at six digits for this screen, and confirm its configured OTP expiry. The default link-only template does **not** supply the code this screen requests.
2. Configure and verify a real transactional SMTP provider under Auth settings. Supabase's default sender has restrictions and is not a general production mail service. Use the operator's verified sending domain, SPF/DKIM/DMARC and an approved support address. Do not put SMTP credentials in the Expo app or commit them. Gmail inbox delivery cannot be established by a unit test.
3. Set Auth's approved Site URL/redirect allowlist to the actual HTTPS app origin and native scheme as applicable. This code-based flow does not consume URL tokens or need a native reset-link handler. Keep Auth email/reset/verification limits enabled, choose the password policy, and review CAPTCHA requirements before public signup. The UI's 60-second resend cooldown is UX, not an abuse boundary.
4. Enable Supabase's **password changed** security notification if appropriate. Test delivery to an operator-controlled Gmail inbox, invalid/expired codes, resend, password-strength rejection and successful sign-in with the new password on web and a native build. Never use a real user's account as a test.

Official behavior checked 30 September 2026: [Supabase email template variables](https://supabase.com/docs/guides/auth/auth-email-templates), [resetPasswordForEmail](https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail), [recovery verification types](https://supabase.com/docs/reference/javascript/auth-verifyotp), [custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp), [Auth rate limits](https://supabase.com/docs/guides/auth/rate-limits).

## Responsibilities and boundaries

`passwordRecovery.ts` validates form input, binds the normalized recipient, rejects duplicate writes, retains a verified in-memory session for a deliberate password-policy retry, and checks the verified recipient. `recoveryClient.ts` uses a separate nonpersistent Supabase Auth client and an 18-second fetch timeout. It never signs a recovery account into the app's main session. After the password update is acknowledged, it requests global refresh-session revocation; a revocation failure is displayed separately from successful password saving. Already-issued access JWTs can remain valid until expiry. A network failure during saving may have committed the password; the UI tells the user to try the new password rather than falsely asserting failure/success.

`useTrackingAccount.ts` and the existing `foodAccountGuard.ts` validate the mounted owner and pin a verified JWT. Every table page adds the owner filter; existing RLS remains the actual server perimeter. Account switch/unmount invalidates results and prevents starting a download/share. Private routes are noindex and absent from the sitemap; `/recover` is publicly reachable and noindex. React text rendering escapes names and errors never expose provider/SQL details.

`trackingData.ts` computes inclusive start/exclusive next-local-midnight boundaries, including DST. It reads explicit allowed columns with keyset pagination, continuing to an empty page rather than assuming a short server page is complete. Limits: 500 requested rows/page, 50 pages/table, 10,000 rows/table, 3 MiB download, 45-second export read deadline; diary reads cap at 1,000 items/20 seconds. Errors/oversize results produce no partial download. Export reads are not a transactionally consistent snapshot; rows created after the export starts are excluded where supported, but concurrent edits can be reflected as pages load. Use smaller ranges for large accounts.

CSV uses quoted fields, escaped embedded quotes, empty unknown values and protection for formula-leading text. Exported CSV is for analysis, not a food-import endpoint. `saveTrackingFile.ts` downloads a browser Blob and revokes its object URL. The native variant uses [Expo FileSystem](https://docs.expo.dev/versions/v54.0.0/sdk/filesystem/) and [Sharing](https://docs.expo.dev/versions/v54.0.0/sdk/sharing/), then deletes the temporary private-cache file after success, dismissal or failure. Sharing cancellation cannot prove the user saved a file; the UI says the share sheet closed. Saved copies belong to the user and are outside app deletion controls. No upload or analytics event includes export contents.

## Rollout and recovery

The screens need the existing feature migrations (including weight history and preferences). Apply the forward-only `20260930000100_account_cascade_context.sql` **after** `20260930000000_billing_actions.sql`; it prevents context invalidation from recreating metadata during Auth account deletion. It changes no existing data or grants. It does not implement account erasure or delete production accounts. Use the deployment guide's reviewed migration procedure; do not run isolated test scripts against a hosted project.

Configure and test the email template/SMTP **before** shipping the recovery screen. Build web with `npm run build:web`. Native FileSystem/Sharing additions require a new compatible native app build; an old runtime must not receive an incompatible OTA update. No new server key or paid AI dependency is required. If recovery must be rolled back, restore the previous client release and its matching Auth email template. Keep additive schema/data; do not drop user tables or reset Auth.

## Verification

Run `npm test`, `npm run typecheck`, `npm run lint`, `npm run typecheck:functions`, `npm run test:db`, `npm run build:web`, and `npx expo export --platform ios --platform android --output-dir output/native-account-ux`.

For controlled browser checks, install Playwright separately or provide `PLAYWRIGHT_MODULE` and `CHROME_BIN`, then `node scripts/check-account-ux.cjs`. It serves `dist` on an ephemeral localhost port, intercepts all Supabase requests, checks 375/768/1440px, and saves screenshots/downloads/results under ignored `output/playwright/account-ux/`. These are test-data checks, not live Gmail or nutrition results.

For a previously initialized disposable local Supabase stack only:

```sh
TRACKBING_LOCAL_KONG_CONTAINER=supabase_kong_trackbing-local-<isolated-id> node scripts/check-account-local.cjs
```

This requires Docker and the local HS256 test configuration; it rejects non-TrackBing container names/non-loopback API bindings. It creates disposable accounts, uses a locally generated recovery OTP to test real Auth verification/password saving, checks cross-owner reads of six tracking tables, and cleans up those test accounts. Local keys never print or target a hosted URL. It does **not** establish Gmail delivery or verify the hosted email template.

Latest verification and remaining launch blockers are recorded in the [implementation report](launch/2026-09-27-implementation-report.md). No production deployment or native device verification is implied.

## Review delivery

The follow-up commits are published on `feat/bee-conversation`, authored by
`towtu <fatowtu123@gmail.com>`, and included in draft
[PR #10](https://github.com/towtu/TrackBing/pull/10). Earlier publication attempts
were blocked; the direct Git push subsequently succeeded and the remote head was
verified. The connected GitHub commit API was not used to replace commit authors.

`output/review/trackbing-account-ux.patch` includes all local commits after the
published branch head, including the preceding food-search/accessibility fix.
It is generated with `git format-patch 5419ecc05df62f11e6addf242158d64b158da5db..HEAD --stdout`.
It is an alternate review artifact for a clean checkout of that earlier head;
the published branch already contains these changes. Applying it with `git am`
was checked in a disposable checkout.
Do not reset a working tree or overwrite unrelated changes to apply it. No merge
or production deployment is part of this handoff.
