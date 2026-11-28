# Barcode labels and dashboard Bee

When a barcode has no usable nutrition record, choose **Create this food** and
copy the calories and all three macros from one column of the package label.
**Per serving** is selected first. **Per 100 g** is available for labels using
that basis. In **Per serving**, enter the labeled weight of one serving in
**Serving weight (g)**, for example 35 or 41. TrackBing saves that weight together
with the original label values. A scan or a review from My Foods opens in grams
at the weight of one serving. Enter 209 g and TrackBing multiplies each nutrient
by 209 divided by the recorded serving weight before rounding. The diary keeps
the actual grams you entered. Switching to servings retains the same portion.
Foods with an unknown serving weight still support serving counts.

Barcode matching checks My Foods, then the TrackBing catalog, then
[USDA FoodData Central](https://fdc.nal.usda.gov/api-guide/) for a valid 12–14 digit
GTIN. Open Food Facts is the final barcode fallback. A USDA match needs the exact
GTIN, a known serving basis, calories and all three macros. Barcode lookup waits
up to three seconds for USDA before trying Open Food Facts. Coverage varies by market.
Diary and recipe scans and typed barcodes use the same order. Name searches in
Log food and the recipe editor show My Foods, the curated list and USDA. My Foods syncs within
the signed-in account. One configured operator can choose **Share this label**
while registering a barcode. Other accounts can retrieve that label by its exact
code. The shared result contains its name, nutrients and basis, with no publisher
identifier, diary data or private food history. Previously saved foods remain
private. Removing a published food from My Foods also removes the shared match.

In a recipe, **Add ingredient → Scan barcode → Create this food** opens the label
form with the barcode filled in. After saving, review the portion and choose
**Add to recipe**. On a saved recipe, **Edit saved recipe** opens the same builder
to add ingredients and save the updated recipe. **Adjust amounts** applies to the
current diary entry.

This cookbook and USDA fallback update uses the existing schema and `USDA_API_KEY`
configuration. The cookbook browser suite covers the flow with test labels.

Dashboard Bee stays on the dashboard when chat opens. Its existing nutrition
and review poses track diary state and chat actions. DeepSeek generates dashboard
text from today's confirmed totals, saved targets and up to five recent food
names and calorie values. New advice still uses the owner, local day and diary
revision cache. Pro chat reads the same bounded list when discussing today's
recorded foods. This uses structured retrieval from Supabase. It needs no vector
index, embedding service or web search.

## Release and verification

1. Apply `20261120000000_shared_barcode_catalog.sql`, then
   `20261121000000_personal_food_serving_grams.sql`.
   Verify the linked project with `supabase db push --linked --dry-run`, then use
   `supabase db push --linked`. The migration adds an empty publisher registry,
   guarded sharing flag and two authenticated lookup functions. The later
   migration adds a nullable serving mass and includes that value in the shared
   label projection. Existing foods retain their original values.
2. In the target project's database, verify the operator's configured sign-in
   email against exactly one confirmed active `auth.users` account. As the
   database operator, register the resulting UUID using
   `insert into public.barcode_catalog_publisher (user_id) values ('<verified-owner-uuid>');`.
   Use an environment-specific verified UUID. Check for an existing registration
   before changing it. Keep email addresses and credentials out of migrations.
3. Deploy `bee-chat` and `ai-food` with the existing DeepSeek and Supabase server configuration.
   The new dashboard path uses the same `DEEPSEEK_API_KEY` and Pro quota. Merge the
   verified client update to trigger the Vercel Git build, then release native
   builds through the existing native workflow as needed.
4. Run `npm test`, `npm run typecheck`, `npm run lint`,
   `npm run typecheck:functions`, `npm run test:db`, `npm run build:web`, and
   `npm run ci:browser -- web motion creation`. Browser cases use synthetic labels,
   accounts and replies. PostgreSQL tests exercise grants, row visibility,
   publisher checks, exact matching and removal in an isolated database.

For a live walkthrough, scan a barcode missing from the databases, enter the
package label per serving with its actual weight, save, and scan again. Check
the opening weight and enter another amount in grams. Confirm and compare the
requested grams and calculated calories in the diary. Try the same product from
a separate controlled account for each visibility setting.
On the dashboard, open Bee and check that its existing guide remains visible.
Add a controlled diary entry and verify that the next insight reflects the new
diary state. Confirm phone keyboard, camera and safe areas on native devices.

To immediately stop shared lookups, remove the publisher registration as the
database operator. Individual entries can be withdrawn by setting
`share_barcode = false` on the publisher's specified food row. To roll back code,
redeploy the previous compatible function and web build. Keep the additive schema
and all saved foods, portions and diary entries.
