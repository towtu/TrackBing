// Illustrative TEST DATA only. Every account/database/provider request is mocked.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('assert/strict');
const fs = require('fs');
const output = 'output/playwright/cookbook-polish';
const owner = '11111111-1111-4111-8111-111111111111';
const ingredient = { name: 'TEST DATA oats', brands: 'Fixture', weight: 100, unit: 'g', default_unit: 'g', nutriments: { 'energy-kcal_100g': 200, proteins_100g: 10, carbohydrates_100g: 30, fat_100g: 5 } };
const recipe = { id: '77777777-7777-4777-8777-777777777777', name: 'TEST DATA breakfast', user_id: owner, ingredients: [ingredient] };
const fixtureUser = { id: owner, aud: 'authenticated', role: 'authenticated', email: 'test@example.test', app_metadata: {}, user_metadata: {}, identities: [] };

async function verify(page, base, width) {
  recipe.name = 'TEST DATA breakfast';
  await require('./fixtures/bee-browser.cjs')(page);
  let failOwnerCheck = true, differentOwner = false, failRead = true, failDelete = true, removed = false;
  let holdVerification = false, releaseVerification, releaseLog, logStatus = 503;
  let reads = 0, summaryCalls = 0;
  let failEditorRead = true, missingUpdatedRow = true, releaseUpdate;
  const updates = [];
  const logs = [], deletes = [];
  await page.route('**/auth/v1/user*', async route => {
    if (holdVerification) await new Promise(resolve => { releaseVerification = resolve; });
    return route.fulfill({ status: failOwnerCheck ? 401 : 200, contentType: 'application/json', body: JSON.stringify(failOwnerCheck ? { code: 'bad_jwt', msg: 'TEST DATA invalid session' } : { ...fixtureUser, id: differentOwner ? '99999999-9999-4999-8999-999999999999' : owner }) });
  });
  await page.route('**/rest/v1/recipes**', async route => {
    const req = route.request(), url = new URL(req.url());
    assert.equal(url.searchParams.get('user_id'), `eq.${owner}`);
    if (req.method() === 'PATCH') {
      assert.equal(url.searchParams.get('id'), `eq.${recipe.id}`);
      assert.equal(url.searchParams.get('select'), 'id');
      updates.push(req.postDataJSON());
      if (!releaseUpdate) await new Promise(resolve => { releaseUpdate = resolve; });
      if (!missingUpdatedRow) recipe.name = updates.at(-1).name;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(missingUpdatedRow ? null : { id: recipe.id }) });
    }
    if (req.method() === 'DELETE') {
      assert.equal(url.searchParams.get('id'), `eq.${recipe.id}`);
      deletes.push(url.search);
      if (failDelete) return route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"Private TEST DATA database detail"}' });
      removed = true;
      return route.fulfill({ status: 204, body: '' });
    }
    assert.equal(req.method(), 'GET');
    if (url.searchParams.has('id')) {
      assert.equal(url.searchParams.get('id'), `eq.${recipe.id}`);
      return route.fulfill({ status: failEditorRead ? 503 : 200, contentType: 'application/json', body: JSON.stringify(failEditorRead ? { message: 'Private TEST DATA editor read detail' } : recipe) });
    }
    reads++;
    return route.fulfill({ status: failRead ? 503 : 200, contentType: 'application/json', body: JSON.stringify(failRead ? { message: 'Private TEST DATA read detail' } : removed ? [] : [recipe]) });
  });
  await page.route('**/rest/v1/food_logs**', async route => {
    if (route.request().method() !== 'POST') return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    const body = route.request().postDataJSON();
    assert.equal(body.length, 1);
    assert.equal(body[0].user_id, owner);
    logs.push(body[0]);
    if (!releaseLog) await new Promise(resolve => { releaseLog = resolve; });
    return route.fulfill({ status: logStatus, contentType: 'application/json', body: logStatus === 201 ? '' : '{"message":"Private TEST DATA insert detail"}' });
  });
  await page.route('**/rest/v1/rpc/refresh_daily_summary', route => {
    summaryCalls++;
    return route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"TEST DATA summary outage"}' });
  });

  await page.goto(`${base}/cookbook`);
  await page.getByText('Your recipes couldn’t load.', { exact: true }).waitFor();
  assert.equal(reads, 0, 'unverified account cannot read private recipes');
  assert.equal(await page.getByText('No saved recipes yet', { exact: true }).count(), 0);
  failOwnerCheck = false;
  const failedRead = page.waitForResponse('**/rest/v1/recipes*');
  await page.getByRole('button', { name: 'Retry recipes', exact: true }).click();
  await failedRead;
  await page.getByRole('button', { name: 'Retry recipes', exact: true }).waitFor();
  failRead = false;
  await page.getByRole('button', { name: 'Retry recipes', exact: true }).click();
  const review = page.getByRole('button', { name: `Review ${recipe.name}`, exact: true });
  await review.waitFor();
  await page.getByText('Protein 10 g · Carbs 30 g · Fat 5 g', { exact: true }).waitFor();
  await page.getByRole('textbox', { name: 'Filter saved recipes', exact: true }).fill('missing');
  await page.getByText('No recipes matching "missing"', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Clear recipe filter', exact: true }).click();
  await page.screenshot({ path: `${output}/list-${width}.png`, fullPage: true, animations: 'disabled' });
  await review.click();
  await page.getByRole('button', { name: 'Recipe portion ⅓', exact: true }).click();
  await page.getByText('67', { exact: true }).waitFor();
  const custom = page.getByRole('textbox', { name: 'Custom recipe portion', exact: true });
  const log = page.getByRole('button', { name: 'Log reviewed recipe', exact: true });
  await custom.fill('1.2.3');
  assert.equal(await custom.getAttribute('aria-invalid'), 'true');
  await log.click();
  assert.equal(logs.length, 0, 'invalid text must not log the last valid amount');
  await custom.fill('0');
  await log.click();
  assert.equal(logs.length, 0);
  await custom.fill('0.5');
  await page.getByText('100', { exact: true }).waitFor();
  assert.equal(await log.evaluate(el => getComputedStyle(el).boxShadow), 'none');
  await page.getByRole('button', { name: 'Adjust recipe amounts', exact: true }).click();
  const amount = page.getByRole('textbox', { name: `Amount of ${ingredient.name}`, exact: true });
  await amount.fill('1.2.3');
  await log.click();
  assert.equal(logs.length, 0, 'malformed ingredient text must not become a partially parsed amount');
  assert.equal(await amount.inputValue(), '1.2.3');
  await page.getByText('Enter a valid amount to review nutrition.', { exact: true }).waitFor();
  await amount.fill('100');
  await page.screenshot({ path: `${output}/review-${width}.png`, fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Close recipe review', exact: true }).click();
  assert.equal(logs.length, 0, 'closing a review must not log');
  await review.click();
  await custom.fill('0.5');
  differentOwner = true;
  await log.click();
  await page.getByText("Your sign-in couldn't be verified. Your reviewed recipe is still here.", { exact: true }).waitFor();
  assert.equal(logs.length, 0, 'another account cannot consume this mounted review');
  differentOwner = false;
  await log.click();
  await page.getByText('Logging...', { exact: true }).waitFor();
  const logRequest = page.waitForResponse(response => new URL(response.url()).pathname === '/rest/v1/food_logs' && response.request().method() === 'POST');
  await log.press('Enter');
  assert.equal(await log.isDisabled(), true);
  assert.equal(await custom.isEditable(), false);
  assert.equal(await page.getByRole('button', { name: 'Close recipe review', exact: true }).isDisabled(), true);
  await page.waitForFunction(() => document.querySelector('[aria-label="Log reviewed recipe"]')?.getAttribute('aria-disabled') === 'true');
  assert.equal(logs.length, 1);
  releaseLog();
  await logRequest;
  await page.getByText("The save couldn't be confirmed. Your reviewed recipe is still here. Check your connection and diary before retrying.", { exact: true }).waitFor();
  assert.equal(await custom.inputValue(), '0.5');
  assert.equal(await page.getByText('Private TEST DATA insert detail', { exact: true }).count(), 0);
  assert.equal(summaryCalls, 0, 'failed insert cannot refresh totals or claim success');
  logStatus = 201;
  const summaryResponse = page.waitForResponse('**/rest/v1/rpc/refresh_daily_summary');
  await log.click();
  await page.getByText('Logged!', { exact: true }).waitFor();
  assert.equal(logs.length, 2, 'one rejected attempt and one confirmed retry');
  assert.equal(logs[1].serving_size, '0.5');
  assert.equal(logs[1].calories, 100);
  assert.equal(logs[1].protein, 5);
  await summaryResponse;
  assert.equal(summaryCalls, 1);
  await review.waitFor();
  await page.getByRole('button', { name: `Edit ${recipe.name}`, exact: true }).click();
  await page.getByText('This recipe couldn’t load. It may have been removed, or your connection needs a retry.', { exact: true }).waitFor();
  const saveRecipe = page.getByRole('button', { name: 'Save recipe', exact: true });
  assert.equal(await saveRecipe.isDisabled(), true, 'failed loading cannot become a blank edit');
  failEditorRead = false;
  await page.getByRole('button', { name: 'Retry loading recipe', exact: true }).click();
  const name = page.getByRole('textbox', { name: 'Recipe name', exact: true });
  await name.waitFor();
  assert.equal(await name.inputValue(), recipe.name);
  await page.getByText('Protein 10 g', { exact: true }).waitFor();
  await page.getByRole('button', { name: `Edit ingredient ${ingredient.name}`, exact: true }).click();
  assert.ok((await page.getByRole('button', { name: 'Ingredient unit g', exact: true }).boundingBox()).height >= 44, 'portion unit controls meet the touch target');
  await page.getByRole('button', { name: 'Increase ingredient portion', exact: true }).click();
  assert.equal(await page.getByRole('textbox', { name: 'Ingredient portion', exact: true }).inputValue(), '110');
  await page.getByText('220', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Update ingredient', exact: true }).waitFor();
  await page.screenshot({ path: `${output}/ingredient-review-${width}.png`, fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Close ingredient review', exact: true }).click();
  await page.locator('[aria-label="Ingredient portion"]').waitFor({ state: 'hidden' });
  await name.fill('TEST DATA edited breakfast');
  await page.screenshot({ path: `${output}/builder-${width}.png`, fullPage: true, animations: 'disabled' });
  await saveRecipe.click();
  await page.getByText('Saving...', { exact: true }).waitFor();
  assert.equal(await saveRecipe.isDisabled(), true);
  assert.equal(await name.isEditable(), false);
  assert.equal(await page.getByRole('button', { name: 'Close recipe builder', exact: true }).isDisabled(), true);
  await saveRecipe.press('Enter');
  assert.equal(updates.length, 1);
  assert.equal(updates[0].ingredients[0].weight, 100, 'cancelling a portion edit keeps the original ingredient');
  releaseUpdate();
  await page.getByText('Could not save recipe', { exact: true }).waitFor();
  assert.equal(await page.getByText('Saved!', { exact: true }).count(), 0, 'an update of zero owned rows cannot claim success');
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  assert.equal(await name.inputValue(), 'TEST DATA edited breakfast');
  missingUpdatedRow = false;
  await saveRecipe.click();
  await page.getByText('Recipe updated.', { exact: true }).waitFor();
  assert.equal(updates.length, 2);
  assert.equal(logs.length, 2, 'saving a recipe does not log its food');
  await page.getByRole('button', { name: `Review ${recipe.name}`, exact: true }).waitFor();
  await page.getByRole('button', { name: `Remove ${recipe.name}`, exact: true }).click();
  await page.getByRole('button', { name: 'Keep it', exact: true }).click();
  assert.equal(deletes.length, 0);
  await page.getByRole('button', { name: `Remove ${recipe.name}`, exact: true }).click();
  holdVerification = true;
  const remove = page.getByRole('button', { name: 'Remove saved recipe', exact: true });
  assert.equal(await remove.getByText('Remove', { exact: true }).evaluate(el => getComputedStyle(el).color), 'rgb(0, 0, 0)', 'destructive action uses readable dark text on the error fill');
  const heldOwnerRequest = page.waitForRequest('**/auth/v1/user*');
  await remove.click();
  await page.getByText('Removing…', { exact: true }).waitFor();
  assert.equal(await remove.isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: 'Keep it', exact: true }).isDisabled(), true);
  await remove.press('Enter');
  assert.equal(deletes.length, 0);
  await heldOwnerRequest;
  assert.equal(typeof releaseVerification, 'function');
  holdVerification = false;
  releaseVerification();
  await page.getByText("The removal couldn't be confirmed. Check your connection and try again.", { exact: true }).waitFor();
  assert.equal(deletes.length, 1);
  assert.equal(await page.getByText('Private TEST DATA database detail', { exact: true }).count(), 0);
  await page.screenshot({ path: `${output}/delete-error-${width}.png`, fullPage: true, animations: 'disabled' });
  failDelete = false;
  await remove.click();
  await page.getByText('No saved recipes yet', { exact: true }).waitFor();
  assert.equal(deletes.length, 2);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
  return { width, verifiedOwnedReadsAndRetry: true, readableMacros: true, exactFractionAndInvalidInput: true, cancelWithoutWrite: true, accountMismatchDenied: true, repeatTapGuard: true, failedSavePreservesReview: true, successfulSaveSurvivesSummaryFailure: true, builderLoadRetryAndPortionCancel: true, missingUpdateRowCannotClaimSaved: true, ownerScopedRecipeEdit: true, ownedDeleteRetry: true };
}

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const local = process.env.UI_BASE_URL ? null : await require('./serve-web-export.cjs').serveExport();
  const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || 'google-chrome', headless: true, args: ['--no-sandbox'] });
  const results = [];
  try {
    for (const width of [375, 768, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await context.newPage();
      const errors = [], failedRequests = [];
      page.on('pageerror', error => errors.push(String(error)));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      page.on('requestfailed', request => { if (!request.failure()?.errorText?.includes('ERR_ABORTED')) failedRequests.push(request.url()); });
      try {
        const result = await verify(page, process.env.UI_BASE_URL || local.base, width);
        const unexpected = errors.filter(error => !/^Failed to load resource: the server responded with a status of (401|503) /.test(error));
        assert.deepEqual(unexpected, []);
        assert.deepEqual(failedRequests, []);
        results.push({ ...result, unexpectedConsoleErrors: 0, failedRequests: 0 });
      } catch (error) {
        await page.screenshot({ path: `${output}/failure-${width}.png`, fullPage: true, animations: 'disabled' });
        throw error;
      } finally { await context.close(); }
    }
  } finally { await browser.close(); if (local) await new Promise(resolve => local.server.close(resolve)); }
  fs.writeFileSync(`${output}/results.json`, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
})().catch(error => { console.error(error); process.exit(1); });
