# Cookbook usability and save safety — 1 October 2026

## Result

The cookbook and recipe builder use full Protein, Carbs and Fat labels with grams. Recipe rows give nutrition more space and show clearly labeled Edit/Remove controls below the food review action. The existing dark/gold palette, ingredient arithmetic and independently entered recipe records remain in use.

- Failed cookbook or edit reads show a retry state. They do not look like an empty collection or an editable blank recipe.
- The review offers **Add to today's food**, with exact fraction arithmetic. Malformed text, zero and more than 100 whole recipes are rejected instead of using the last valid amount. A third retains its precision in `serving_size` rather than being rounded to 0.33 while macros use a different fraction.
- An unsuccessful log keeps the reviewed ingredients and portion, with an inline, recoverable error. A successful insertion closes the review and emits the existing food-log update event; a separate failed totals refresh cannot reverse that success.
- Save/remove actions acquire their repeat-tap guard before account verification, disable relevant controls while pending, and check the mounted account again after the response. Cookbook reads/deletes and builder reads/updates have explicit owner filters and use the existing account-bound client.
- Editing a recipe must return the updated owned row before showing Saved. A removed/inaccessible row cannot return a false successful update. Recipe editing does not write any diary entry.
- Ingredient review preserves its values and action during its closing animation, avoiding a brief zero-nutrition/wrong-button flicker. Closing an ingredient review leaves its original amount intact.

Changed files: `app/(tabs)/cookbook.tsx`, `app/create-recipe.tsx`, `src/lib/foodValidation.ts` and its tests, plus `scripts/check-cookbook-ui.cjs` and this document. No migration, dependency, secret or provider configuration change is required for this follow-up.

## Verification

The browser verifier intercepts all account, database and paid-provider requests with explicitly identified **TEST DATA**. At 375, 768 and 1440 px it checks:

- Failed session verification prevents private recipe reads; a failed database read offers retry.
- Macro labels, filtering, one-third/half arithmetic, invalid portions, cancellation and flat actions.
- Account mismatch prevents a mounted recipe review from writing to a different account.
- Held writes/account checks disable controls; repeated activation sends one request.
- Failed insertion preserves the exact reviewed portion. Confirmed insertion remains successful during a mocked totals outage.
- Recipe edit load retry, ingredient edit cancellation, no false Saved for an update of zero owned rows, and an owner-scoped successful update.
- Removal cancellation, failed removal recovery and an explicitly owner-scoped deletion.

Verified locally: **46 suites / 628 tests**, typecheck, lint, 23-route web export, iOS/Android Hermes exports and the browser walkthrough at all three widths, with zero unexpected console errors or failed requests. Screenshots/results are in ignored `output/playwright/cookbook-polish/`.

```sh
npm run typecheck
npm test
npm run lint
npm run build:web
PLAYWRIGHT_MODULE=<installed-playwright-module> CHROME_BIN=<chrome-executable> node scripts/check-cookbook-ui.cjs
npx expo export --platform ios --platform android --output-dir output/native-cookbook-polish
node scripts/check-secrets.mjs --dist
npm audit
```

For a manual walkthrough with a controlled account, open Cookbook, filter/clear recipes, review a half or third, cancel, edit an ingredient and cancel its change, then save a reviewed recipe edit. Verify diary addition and removal separately. Do not use real food histories for screenshots.

## Security and release limits

Existing owner-only RLS and server recipe/food constraints remain the database boundary. Client validation improves feedback; it does not grant write permissions. Raw database errors are not displayed. No private content or credentials are logged, no grounded Google results are reused and no new paid API calls are introduced.

The repeat-tap protection covers this mounted manual form. It is not the durable cross-device confirmation mechanism used by Bee. If a manual insert response is lost, its outcome is unknown; the error asks the user to check the diary before retrying. This follow-up does not claim new database-level idempotency for manual recipe insertion.

The audit still reports **16 existing advisories: 1 high, 15 moderate, 0 critical**. The high finding is `image-size` parser denial of service; review its Expo/Metro dependency path and a compatible patch separately. No package changed here.

All browser requests used mocks; no real user food/recipe records were changed. Native export establishes compilation, not device keyboard, camera, VoiceOver/TalkBack or cross-device runtime behavior. Production rollout/provider/legal requirements in the main launch report remain outstanding. No production deployment or merge is included.
