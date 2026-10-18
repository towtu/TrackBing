# DeepSeek Bee and nutrition-label photos

Updated 18 October 2026. This is the active provider setup and supersedes the
Gemini provider choice in the September brief. Local implementation is separate
from production deployment and live provider verification.

## What changed

- `bee-chat` and compatible `ai-food` now use DeepSeek V4 Pro for interpretation
  and replies. The existing gist/exact personal/barcode sources retain priority,
  DeepSeek Search follows a source miss, and USDA remains the final independent
  fallback. There are no active Gemini or Tavily calls in these endpoints.
- `deepseekProviders.ts` calls the official Chat Completions and standalone
  Search endpoints. Search is one application-controlled request with five
  results. Built-in Responses search was deliberately avoided: DeepSeek's
  current documentation says `max_tool_calls` is ignored. This preserves a real
  bound on paid search calls. No returned URL is fetched by our server.
- Search citations refer only to returned, validated public URLs. Search-only
  text is informational, never nutrition for a pending action, recipe or shared
  cache. Precise nutrition claims in the generated search explanation are
  rejected. This deliberately conservative branch asks for independent records
  or a package label before logging. Google widgets remain supported by the
  compatibility renderer but are not fabricated for DeepSeek.
- `ai-label` uses `deepseek-flash`, the documented image-capable model. V4 Pro
  does not accept label images. The same server-only API key serves both.
- Bee's inline label reader takes/chooses an image, previews it and requires
  **Read label** before transmission. It resizes to a longest edge of 1600 px,
  re-encodes JPEG, strips EXIF/XMP/IPTC/comments and rejects uploads over 2 MB.
  The server revalidates JPEG signature/segments/dimensions (maximum 2048 px
  per side and four million pixels) and strips metadata again. No image URLs,
  file uploads, storage bucket or image bytes in chat/database logs are used.
- Extraction retains one column's basis, kcal/kJ, serving weight and nullable
  macros. The user can correct all fields and select a portion. kJ / 4.184 and
  portion scaling happen in application code. Unknown macros remain blank;
  the current complete-macro diary schema prevents logging until supplied.
- **Review food** sends the user's checked label values to a deterministic
  bee-chat branch, creating a source `user_label` proposal without another paid
  request. **Add to today** uses the existing owner-scoped, atomic confirmation
  RPC and refreshes the dashboard. Cancel never logs anything.

## Server configuration

Use `supabase/functions/.env` locally (ignored), or Supabase project secrets.
Never use an `EXPO_PUBLIC_*` name for any of these:

```dotenv
DEEPSEEK_API_KEY=<secret>
DEEPSEEK_MODEL=deepseek-v4-pro
DEEPSEEK_VISION_MODEL=deepseek-flash
DEEPSEEK_SEARCH_ENABLED=true
DEEPSEEK_LABEL_ENABLED=true
DEEPSEEK_DATA_USE_CONFIRMED=false
BEE_AI_ENABLED=true
```

Only set `DEEPSEEK_DATA_USE_CONFIRMED=true` after reviewing DeepSeek's current
API terms/privacy handling for private diary/body data and updating the product
privacy notice. Stateless context does not establish zero logging, zero
retention or a no-training agreement. Search availability does not grant rights
to build a reusable nutrition database from third-party pages. Keep paid-account
spend alerts and provider rate-limit monitoring configured separately.

Existing `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and
`USDA_API_KEY` remain server-side. Existing Plus/Pro entitlement configuration
is required. Keys were unavailable locally; no paid live calls were made.

## Migration and rollout order

**No new schema migration is needed for this increment.** It reuses the current
15 forward migrations, `ai_budget_requests`, usage tables, Bee threads/pending
actions and protected food provenance. Apply any unapplied existing migrations
in filename order before deploying the functions; see the existing deployment
guide for historical base schema and recipe setup. Do not reset a database.

1. Complete the dependency security gate and configure the isolated test
   project's existing migrations, entitlements, provider key and privacy gate.
2. Review a dry-run, apply unapplied migrations, then deploy the backend before
   the client:

   ```sh
   supabase db push --dry-run --linked
   supabase db push --linked
   supabase functions deploy bee-chat ai-food ai-label --project-ref <PROJECT_REF> --no-verify-jwt
   ```

   `--no-verify-jwt` follows this repo's auth setup: every handler independently
   validates `auth.getUser()`; a nonempty bearer token never establishes access.
   The reviewed release workflow deploys all seven app functions.
3. Run the controlled live walkthrough below, then publish the web build and
   rebuild native binaries to include the two Expo photo modules/permissions.
   JavaScript export does not prove native camera permission or device behavior.
4. Remove unused Gemini/Tavily secrets only after old deployed callers have
   been retired. Do not remove another branch/deployment's keys prematurely.

The change remains on `feat/deepseek-label-photos`; it does not merge or deploy
production or activate customer payments.

## Quotas, privacy and recovery

- One explicit photo read reserves one existing `ai_food_assist` request shared
  with ordinary Bee/ai-food calls. Basic has no AI access; adult Plus/Pro users
  follow the unchanged monthly request/input/output and per-minute limits.
- One photo uses at most one Flash call, 4096 output tokens, a 25-second provider
  timeout and a 35-second request deadline. No Search runs on a label photo.
- A before-HTTP zero-token attempt marker prevents a consumed request from
  restarting after lease expiry; a second record meters actual token usage.
  Successful retries return the original extraction. Explicit new reads can
  consume another allowance; no automatic paid retry is performed.
- Extracted fields can remain in private AI request-replay records for the
  existing account/accounting lifecycle; these are not the 30-day chat store.
  Images are never persisted on the server. Closing the reader clears its
  in-memory image; OS/library/picker temporary files have a separate lifecycle.
- Only numeric token/search counts are logged. Photo bytes, food query text,
  label text, account identifiers and credentials are excluded from telemetry.
- Rollback: set `BEE_AI_ENABLED=false` or disable only label/search gates, then
  restore a compatible previous client/function version. Keep all user data and
  migrations. A Gemini rollback needs its own provider/privacy configuration;
  changing only a model string is not supported.

## Verification and live walkthrough

Automated provider/image tests use explicitly identified synthetic TEST DATA.
The browser suite intercepts all Supabase/provider traffic; its generated label
is not real product nutrition. Real PostgreSQL tests use disposable accounts.

```sh
npm run typecheck
npm test
npm run lint -- --no-cache
npm run typecheck:functions
npm run test:db
npm run build:web
npm run ci:browser -- label
npx expo export --platform all --output-dir output/native/deepseek-label
node scripts/check-secrets.mjs --dist
node scripts/check-secrets.mjs --export-dir output/native/deepseek-label
npm audit
npm run ci:audit
```

Live web/mobile walkthrough after configuration:

1. Same adult test account on web and a physical native device: common-food
   lookup, preparation/portion corrections, cancel and confirmed save; compare
   persisted history and dashboard totals. Keep all real user accounts untouched.
2. Exact Philippine product with no independent record: inspect real Search
   results/citations and no food draft from search-only evidence. Gist/USDA
   food hits should not launch unnecessary search.
3. Photograph a real nutrition panel including serving size. Confirm only one
   column was read, kJ/kcal are distinguished and the photo is not stored in
   application tables. Correct transcription before review. Try blurred labels,
   missing macros, two-column panels and a ten-bar multipack versus one bar.
4. Cancel once; verify no diary change. Review two bars; compare the pending
   total to the package manually, then Add once. Retry the same confirmation and
   verify one row. Verify cross-account denial and sign-out/account-switch cleanup.
5. Deny camera permission, select a library photo, disconnect during reading,
   retry with the same key, and test provider-key/quota failures. Inspect actual
   latency and token/search usage before enabling broader access.

Automated evidence validation cannot prove OCR accuracy, label authenticity,
nutrition-panel revision, or the semantic truth of every web sentence. The
visible editable review and separate database confirmation are essential.

## Official references (checked 18 October 2026)

- [DeepSeek pricing and model capabilities](https://api-docs.deepseek.com/quick_start/pricing/)
- [Chat Completions/image input](https://api-docs.deepseek.com/api/create-chat-completion/)
- [Search and Fetch](https://api-docs.deepseek.com/guides/search/)
- [Responses compatibility and tool-call limits](https://api-docs.deepseek.com/guides/responses_api/)
- [DeepSeek API terms](https://cdn.deepseek.com/policies/en-UK/deepseek-open-platform-terms-of-service.html)
- [Expo ImagePicker](https://docs.expo.dev/versions/v54.0.0/sdk/imagepicker/)

## Dependency findings

The baseline contained the critical shell-quote advisory
GHSA-pqg4-j6r4-53mv at 1.10.0. The focused lockfile update installs 1.12.0.
Current audit still reports 26 high and 21 moderate affected packages, with no
critical finding. The strict CI audit remains failing; its inherited-severity
validation reports an unexplained npm severity, and prior high-advisory
exceptions have reached their expiry date. No exception was broadened or
extended. Resolve the underlying advisories/policy evidence before release.

## Local verification results — 18 October 2026

| Check | Result |
|---|---|
| Frontend typecheck and lint | Passed |
| Unit/mocked integration tests | 904 passed across 60 files |
| Deno Edge Function checks | All seven functions passed; changed functions rechecked after review fixes |
| PostgreSQL | Full existing suite passed; adaptive suite plus new label replay/ownership/concurrent-confirmation test passed against disposable PostgreSQL 16 |
| Deno handler tests | 17 passed |
| Expo web | 23 routes exported and finalized |
| Expo native JavaScript | iOS and Android Hermes exports passed; no signed binary/device test |
| Browser | Label preview, explicit upload, kcal/kJ and serving review, missing-macro rejection, cancel and explicit failed-read recovery at 375/768/1440; public web, motion and creation regressions passed with controlled mocks |
| Workflow policy and actionlint | Passed; ai-label and label browser suite included in releases/CI |
| Secret patterns | Tracked files and web/native artifacts scanned; no findings (not a full credential-history audit) |
| Dependency audit | Critical baseline shell-quote fixed; 26 high/21 moderate remain and strict CI audit fails |
| Independent review | Five initial findings plus SDK transport recovery fixed with regressions; no remaining concrete feature blocker reported |
| Live provider / production / device camera | Not run: no DeepSeek key, deployment or physical-device environment available |

Security check: reviewed validated session ownership, service-only RPC access,
shared atomic budgets, single-search bounds, image signatures/dimensions and
metadata stripping (including progressive scans), source URL binding, untrusted
model/image text, nullable macros, separate idempotent food confirmation,
account-switch cancellation, safe errors and secret handling. Dependency findings
remain a release blocker. These results establish local behavior, not OCR quality
on real packages or a production security certification.
