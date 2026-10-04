// Controlled TEST DATA only. No request reaches a real auth, database or AI service.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('assert/strict');
const fs = require('fs');
const { fixtureEvent } = require('./fixtures/bee-browser.cjs');
const output = 'output/playwright/auth-polish';
const fixturePassword = 'Fixture-only-password1!';

async function verify(page, base, width) {
  const calls = [];
  let releaseSignIn;
  const signInStarted = fixtureEvent('sign-in request');
  let status = 400;
  await page.route('**/auth/v1/**', async route => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    calls.push({ path, method: req.method() });
    if (path.endsWith('/token')) {
      if (!releaseSignIn) await new Promise(resolve => { releaseSignIn = resolve; signInStarted.signal(); });
      return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ code: status === 429 ? 'over_request_rate_limit' : 'invalid_credentials', msg: 'Internal fixture detail must never appear in the UI' }) });
    }
    if (path.endsWith('/signup')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: { id: '11111111-1111-4111-8111-111111111111', email: 'test@example.test', identities: [] }, session: null }) });
    if (path.endsWith('/recover')) return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    if (path.endsWith('/verify')) return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ code: 'otp_expired', msg: 'Expired TEST DATA code' }) });
    throw new Error(`Unexpected auth request: ${req.method()} ${path}`);
  });
  await page.route('**/rest/v1/**', () => { throw new Error('Signed-out form must not write tracking data'); });
  await page.route('**/functions/v1/**', () => { throw new Error('Signed-out form must not call paid APIs'); });
  const signIns = () => calls.filter(call => call.path.endsWith('/token')).length;
  await page.goto(base);
  const submit = page.getByRole('button', { name: 'Sign In', exact: true });
  const email = page.getByRole('textbox', { name: 'Email address', exact: true });
  const password = page.getByLabel('Password', { exact: true });
  await submit.waitFor();
  await page.screenshot({ path: `${output}/login-${width}.png`, fullPage: true });
  assert.equal(await submit.evaluate(el => getComputedStyle(el).boxShadow), 'none');
  await submit.click();
  await page.getByRole('alert').filter({ hasText: 'Enter both your email and password.' }).waitFor();
  assert.equal(await email.evaluate(el => document.activeElement === el), true);
  assert.equal(signIns(), 0);
  await email.fill('invalid-email');
  await password.fill(fixturePassword);
  await submit.click();
  await page.getByText('Enter a valid email address of up to 254 characters.', { exact: true }).waitFor();
  assert.equal(await email.getAttribute('aria-invalid'), 'true');
  assert.equal(signIns(), 0);
  await email.fill(' test@example.test ');
  await email.press('Enter');
  assert.equal(await password.evaluate(el => document.activeElement === el), true);
  assert.equal(await password.evaluate(el => getComputedStyle(el.parentElement).borderTopColor), 'rgb(232, 185, 60)', 'the complete password field must show focus');
  await page.getByRole('button', { name: 'Show password', exact: true }).click();
  assert.equal(await password.evaluate(el => el.type), 'text');
  assert.equal(await password.inputValue(), fixturePassword);
  await page.getByRole('button', { name: 'Hide password', exact: true }).click();
  assert.equal(await password.evaluate(el => el.type), 'password');
  await submit.focus();
  assert.equal(await submit.evaluate(el => getComputedStyle(el).borderTopColor), 'rgb(0, 0, 0)', 'keyboard focus must be visible');
  const before = await submit.boundingBox();
  await submit.press('Enter');
  await page.getByText('Signing in…', { exact: true }).waitFor();
  await signInStarted.wait();
  assert.equal(await submit.isDisabled(), true);
  const during = await submit.boundingBox();
  assert.equal(during.height, before.height);
  assert.equal(during.y, before.y, 'loading must not shift the action');
  await submit.press('Enter');
  assert.equal(signIns(), 1, 'repeat activation must not send duplicate requests');
  await page.screenshot({ path: `${output}/loading-${width}.png`, fullPage: true });
  releaseSignIn();
  await page.getByText('Check your email and password, and make sure your email is verified. Then try again.', { exact: true }).waitFor();
  assert.equal(await password.inputValue(), fixturePassword);
  assert.equal(await page.getByText('Internal fixture detail must never appear in the UI', { exact: true }).count(), 0);
  assert.equal(await submit.isDisabled(), false);
  await page.screenshot({ path: `${output}/error-${width}.png`, fullPage: true });
  status = 429;
  await submit.click();
  await page.getByText('Too many sign-in attempts. Wait a moment before trying again.', { exact: true }).waitFor();
  assert.equal(signIns(), 2);
  assert.equal(await page.evaluate(value => Object.values(localStorage).some(saved => saved.includes(value)), fixturePassword), false);
  await page.getByRole('button', { name: 'Forgot password?', exact: true }).click();
  const recoveryEmail = page.getByRole('textbox', { name: 'Recovery email address', exact: true });
  await recoveryEmail.fill('test@example.test');
  await recoveryEmail.press('Enter');
  const code = page.getByRole('textbox', { name: 'Recovery verification code', exact: true });
  await code.waitFor();
  assert.equal(await code.evaluate(el => document.activeElement === el), true);
  await code.fill('000000');
  await code.press('Enter');
  const nextPassword = page.getByLabel('New password', { exact: true });
  assert.equal(await nextPassword.evaluate(el => document.activeElement === el), true);
  await nextPassword.fill(fixturePassword);
  await nextPassword.press('Enter');
  const repeat = page.getByLabel('Repeat new password', { exact: true });
  assert.equal(await repeat.evaluate(el => document.activeElement === el), true);
  await repeat.fill(fixturePassword);
  await repeat.press('Enter');
  await page.getByText('That code is invalid or expired. Check it or request a new code.', { exact: true }).waitFor();
  assert.equal(calls.some(call => call.path.endsWith('/user')), false, 'invalid recovery must never update password');
  await page.screenshot({ path: `${output}/recovery-${width}.png`, fullPage: true });
  await page.getByRole('button', { name: 'Use another email', exact: true }).click();
  await recoveryEmail.waitFor();
  await page.goto(base);
  await page.getByRole('button', { name: 'Create a new TrackBing account', exact: true }).click();
  await page.getByText('Step 1 of 3 · Your daily targets', { exact: true }).waitFor();
  await page.getByRole('textbox', { name: 'Age in years', exact: true }).fill('30');
  await page.getByRole('textbox', { name: 'Weight in kilograms', exact: true }).fill('72.4');
  await page.getByRole('textbox', { name: 'Height in centimeters', exact: true }).fill('170');
  await page.screenshot({ path: `${output}/targets-${width}.png`, fullPage: true });
  await page.getByRole('button', { name: 'Calculate & Continue', exact: true }).click();
  await page.getByText('Step 2 of 3 · Your account', { exact: true }).waitFor();
  await email.fill('test@example.test');
  const signupPassword = page.getByLabel('Password, at least 8 characters', { exact: true });
  await signupPassword.fill('short');
  await page.getByRole('button', { name: 'Create Account', exact: true }).click();
  await page.getByText('Use at least 8 characters for your password.', { exact: true }).waitFor();
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Password, at least 8 characters', {}, { timeout: 2500 });
  assert.equal(calls.filter(call => call.path.endsWith('/signup')).length, 0);
  await signupPassword.fill(fixturePassword);
  await page.screenshot({ path: `${output}/signup-${width}.png`, fullPage: true });
  await page.getByRole('button', { name: 'Create Account', exact: true }).click();
  await page.getByRole('heading', { name: 'Verify Email', exact: true }).waitFor();
  await page.screenshot({ path: `${output}/verification-${width}.png`, fullPage: true });
  assert.equal(calls.filter(call => call.path.endsWith('/signup')).length, 1);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
  return { width, flatButton: true, inlineValidationAndFocus: true, passwordVisibility: true, keyboardFlow: true, stableLoadingAndDuplicateGuard: true, retryAndQuotaError: true, recoveryCodeFailureSafe: true, signupAndVerification: true, passwordNotPersisted: true };
}

async function verifyMyFoods(page, base, width) {
  const fixture = await require('./fixtures/bee-browser.cjs')(page);
  const owner = '11111111-1111-4111-8111-111111111111';
  const food = { id: '88888888-8888-4888-8888-888888888888', user_id: owner, name: 'TEST DATA saved oats', calories: 205, protein: 10, carbs: 30, fat: 5, default_unit: 'g', ai_estimated: false };
  let failLoad = true, failOwnerCheck = true, removed = false, reads = 0;
  const deletes = [];
  const fixtureUser = { id: owner, aud: 'authenticated', role: 'authenticated', email: 'test@example.test', app_metadata: {}, user_metadata: {}, identities: [] };
  await page.route('**/auth/v1/user*', route => route.fulfill({ status: failOwnerCheck ? 401 : 200, contentType: 'application/json', body: JSON.stringify(failOwnerCheck ? { code: 'bad_jwt', msg: 'Invalid TEST DATA session' } : fixtureUser) }));
  await page.route('**/rest/v1/personal_foods**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    assert.equal(url.searchParams.get('user_id'), `eq.${owner}`);
    if (request.method() === 'DELETE') {
      assert.equal(url.searchParams.get('id'), `eq.${food.id}`);
      deletes.push(url.search);
      removed = true;
      return route.fulfill({ status: 204, body: '' });
    }
    assert.equal(request.method(), 'GET');
    reads++;
    return route.fulfill({ status: failLoad ? 503 : 200, contentType: 'application/json', body: JSON.stringify(failLoad ? { message: 'Internal fixture detail' } : removed ? [] : [food]) });
  });
  await page.goto(`${base}/my-foods`);
  await page.getByText('Your saved foods couldn’t load.', { exact: true }).waitFor();
  assert.equal(await page.getByText('No custom foods yet', { exact: true }).count(), 0, 'failed reads must not look like an empty collection');
  assert.equal(reads, 0, 'an unverified account must not read private foods');
  failOwnerCheck = false;
  const failedRead = page.waitForResponse('**/rest/v1/personal_foods*', { timeout: 5000 });
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await failedRead;
  await page.getByText('Your saved foods couldn’t load.', { exact: true }).waitFor();
  assert.equal(reads, 1);
  failLoad = false;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  const review = page.getByRole('button', { name: `Review ${food.name}`, exact: true });
  await review.waitFor();
  await page.getByRole('textbox', { name: 'Filter saved foods', exact: true }).fill('no match');
  await page.getByText('No foods matching "no match"', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Clear food filter', exact: true }).click();
  await review.click();
  const portion = page.getByRole('textbox', { name: 'Food portion', exact: true });
  await portion.waitFor();
  await page.getByRole('button', { name: 'Increase portion', exact: true }).click();
  assert.equal(await portion.inputValue(), '110');
  await page.getByRole('button', { name: 'Decrease portion', exact: true }).click();
  assert.equal(await portion.inputValue(), '100');
  assert.equal(await page.getByRole('button', { name: 'Log this food', exact: true }).evaluate(el => getComputedStyle(el).boxShadow), 'none');
  await page.screenshot({ path: `${output}/my-foods-review-${width}.png`, fullPage: true });
  await page.getByRole('button', { name: 'Close food review', exact: true }).click();
  await page.getByRole('button', { name: `Remove ${food.name}`, exact: true }).click();
  await page.getByRole('button', { name: 'Keep it', exact: true }).click();
  assert.equal(deletes.length, 0, 'cancel must not delete');
  let releaseOwnerCheck;
  const ownerCheckStarted = fixtureEvent('saved food removal account verification');
  await page.route('**/auth/v1/user*', async route => {
    await new Promise(resolve => { releaseOwnerCheck = resolve; ownerCheckStarted.signal(); });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixtureUser) });
  });
  await page.getByRole('button', { name: `Remove ${food.name}`, exact: true }).click();
  const remove = page.getByRole('button', { name: 'Remove saved food', exact: true });
  await remove.click();
  await page.getByText('Removing…', { exact: true }).waitFor();
  assert.equal(await remove.isDisabled(), true, 'disable while the account check is pending');
  assert.equal(await page.getByRole('button', { name: 'Keep it', exact: true }).isDisabled(), true);
  await remove.press('Enter');
  assert.equal(deletes.length, 0);
  await page.waitForFunction(() => document.querySelector('[aria-label="Remove saved food"]')?.getAttribute('aria-disabled') === 'true');
  await ownerCheckStarted.wait();
  assert.equal(typeof releaseOwnerCheck, 'function');
  releaseOwnerCheck();
  await page.getByText('No custom foods yet', { exact: true }).waitFor();
  assert.equal(deletes.length, 1);
  assert.equal(fixture.requests.filter(request => request.path === '/rest/v1/food_logs' && request.method !== 'GET').length, 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
  return { savedFoodLoadRetry: true, accessibleReviewAndCancel: true, ownerScopedDeletion: true };
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
        const foods = await verifyMyFoods(page, process.env.UI_BASE_URL || local.base, width);
        // Chrome reports HTTP errors for the intentionally rejected fixture requests.
        const unexpected = errors.filter(error => !/^Failed to load resource: the server responded with a status of (400|401|403|429|503) /.test(error));
        assert.deepEqual(unexpected, []);
        assert.deepEqual(failedRequests, []);
        results.push({ ...result, ...foods, unexpectedConsoleErrors: 0, failedRequests: 0 });
      } catch (error) {
        await page.screenshot({ path: `${output}/failure-${width}.png`, fullPage: true });
        throw error;
      }
      finally { await context.close(); }
    }
  } finally { await browser.close(); if (local) await new Promise(resolve => local.server.close(resolve)); }
  fs.writeFileSync(`${output}/results.json`, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
})().catch(error => { console.error(error); process.exit(1); });
