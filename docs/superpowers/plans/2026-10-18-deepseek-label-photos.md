# DeepSeek Bee and nutrition-label photos

User-authorized change, 2026-10-18. Supersedes the Gemini provider choice in the
September brief; preserves its ownership, confirmation and source restrictions.

## Design

- V4 Pro handles bounded JSON interpretation and adaptive replies. Use the
  standalone DeepSeek Search API for one bounded search, rather than Responses
  built-in search: the latter ignores `max_tool_calls`, so it cannot enforce our
  existing per-turn search reservation. No arbitrary fetching or shared cache.
- Keep gist/exact owned/barcode records first and USDA last. Search-only answers
  remain informational; citations must identify returned results. Preserve the
  Google renderer for compatibility, without calling Google in the active path.
- DeepSeek Flash (the image-capable model, not V4 Pro) reads one resized label
  photo. `ai-label` authenticates, checks age/privacy/entitlements, reserves the
  existing shared food-assistance budget, and replays successful request IDs.
  The database retains only extracted fields and the image fingerprint, never
  image bytes, filenames, EXIF or a public image URL.
- An inline Bee panel lets the user take/choose a photo, explicitly send it,
  correct extracted values, select one nutrition column and requested portion,
  and request a food review. Complete user-reviewed label values create a food
  proposal deterministically through bee-chat. A later Add uses the existing
  atomic confirmation; missing macros remain unknown and prevent logging.
- No new schema or food-writing RPC is required. Existing food/AI-budget tables,
  leases, ownership and unique confirmation keys are reused. Images/response
  bodies are bounded; magic bytes, pixel dimensions, units and numbers are
  validated independently of model instructions. No paid retries in background.

## Threat model

Photos can contain personal information, huge/deceptive files or prompt
injection. Provider output can confuse kcal/kJ or serving/pack columns. Keep
keys server-side; do not fetch image URLs; resize/re-encode before upload; cap
bytes/dimensions; never execute image text or model tools; require user review
and the existing explicit, owner-scoped confirmation before diary writes.

## Ordered slices

1. Add failing adapter tests; implement bounded DeepSeek JSON/Search and switch
   both active endpoints, preserving quotas and response compatibility.
2. Test label schema/image validation, extraction, request replay and quotas;
   implement ai-label and deterministic user-label proposals.
3. Add camera/library input and editable label review in the existing Bee sheet;
   cover complete, partial, failure, cancel and account-switch flows.
4. Wire the endpoint/browser checks into CI/release; update setup/privacy docs.
5. Run app/backend/database checks, web/native exports, browser checks at
   375/768/1440, secret scans and dependency audit; review diff and commit.

## Verification limits

Paid APIs are mocked unless usable credentials are available. No production
deployment, real diary changes or payment activation. Native camera permission
and actual photo-reading accuracy require a device and configured provider.

## Official references checked 2026-10-18

- https://api-docs.deepseek.com/api/create-chat-completion/
- https://api-docs.deepseek.com/quick_start/pricing/
- https://api-docs.deepseek.com/guides/search/
- https://api-docs.deepseek.com/guides/responses_api/
- https://docs.expo.dev/versions/v54.0.0/sdk/imagepicker/

Provider data-use terms and the privacy notice must be reviewed before setting
`DEEPSEEK_DATA_USE_CONFIRMED=true`. A search service does not grant rights to
reuse third-party pages as a nutrition database.
