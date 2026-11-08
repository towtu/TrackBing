# Login and saved-food usability — 1 October 2026

## Changes

- Flat gold actions and form cards replace the login, onboarding and verification glows. Existing dark/gold colors, logo, routes and Supabase authentication remain in use.
- A shared `AuthButton` keeps its label, spinner and dimensions visible during a request. It announces busy/disabled state and shows keyboard focus without animation.
- Login adds Show/Hide password, email-to-password keyboard navigation, nearby recovery access, inline validation and recoverable account/provider errors. Invalid fields receive focus; credentials stay in component state and are not logged or newly persisted.
- Signup displays its progress and retains the existing target calculation and age safeguards. Password recovery uses the same button and moves keyboard focus through code, password and repeat-password fields.
- My Foods has readable macro names, labeled review/portion/filter controls, a flat logging button, a failed-load/retry state, and an account-bound delete action with an explicit owner filter and repeat-click guard. Food arithmetic and source flags stay unchanged.

React Native Web's `on-drag` keyboard-dismiss setting blurs inputs on *every* scroll, including automatic scrolling to invalid fields. Auth uses `none` on web and preserves `on-drag` on native. Inputs use their full bordered field as the focus indicator; other controls retain the global visible outline.

## Verification and walkthrough

`scripts/check-auth-ui.cjs` intercepts every authentication, database and provider request with explicitly marked test data. At 375, 768 and 1440 px it exercises empty/malformed inputs, field focus, password visibility, Enter navigation, unchanged button dimensions while loading, repeated activation, rejected credentials, quota rejection, invalid recovery, signup and verification. Its signed-in fixture verifies My Foods read failure/retry, filtering, portion adjustment, cancellation without logging, and one owner-scoped deletion.

The existing `scripts/check-account-ux.cjs` also exercises invalid and successful recovery, temporary recovery-session isolation, private route guards, local-day diary history and CSV/JSON downloads at all three widths. Screenshots/results are under `output/playwright/auth-polish/` and `output/playwright/account-ux/` (ignored generated artifacts).

Verified locally: 46 unit/mocked integration suites with 619 tests, application typecheck and lint, 23-route web export, both browser walkthroughs at all three widths (zero unexpected console errors or failed requests), and iOS/Android Hermes exports. The tracked/export secret-pattern scan passed; it is not proof against every credential format. Existing dependency advisories remain documented in the main launch report; no dependencies changed here.

Run:

```sh
npm run typecheck
npm test
npm run lint
npm run build:web
node scripts/check-secrets.mjs --dist
# Playwright and Chrome must be available to the verifier. A local server starts automatically.
PLAYWRIGHT_MODULE=<installed-playwright-module> CHROME_BIN=<chrome-executable> node scripts/check-auth-ui.cjs
PLAYWRIGHT_MODULE=<installed-playwright-module> CHROME_BIN=<chrome-executable> node scripts/check-account-ux.cjs
npx expo export --platform ios --platform android --output-dir output/native-auth-polish
```

For a manual walkthrough, open the local export, try an empty sign-in, show/hide a password and use Enter from email. Check the recovery and signup steps. With a controlled account, open My Foods, review a portion, cancel, filter/clear, and cancel a removal before confirming one. Do not use real food histories for visual testing.

## Security and release

No new dependencies, migrations, server secrets or paid API calls. Supabase still validates credentials; client validation improves feedback. Recovery still requires a verified code before changing a password. My Foods revalidates its mounted account before deletion and checks it again after the response; existing owner-only RLS remains the database boundary. Raw auth/deletion server errors are not displayed, and password content is absent from analytics and new storage.

This is local/mocked verification. Native export does not establish device keyboard, autofill or VoiceOver/TalkBack behavior. Check those on an iOS/Android device before release. The existing draft PR and production rollout requirements remain applicable; this change has not been merged or deployed.
