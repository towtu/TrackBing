// Controlled TEST DATA only. No real account, nutrition record, or paid API is used.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('assert/strict');
const fs = require('fs');
const owner = '11111111-1111-4111-8111-111111111111';
const output = 'output/playwright/bee-motion';
const now = new Date();
const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(now);

async function install(page, { calories = [], checkedIn = false, fail = false, badOwner = false, macros = [] } = {}) {
  const fixture = await require('./fixtures/bee-browser.cjs')(page);
  const scopedReads = [];
  // These specific read-only paths supersede the general controlled fixture.
  for (const table of ['user_goals', 'food_logs', 'weight_logs']) {
    await page.route(`**/rest/v1/${table}**`, route => {
      const url = new URL(route.request().url());
      assert.equal(route.request().method(), 'GET', 'art cannot write to private records');
      const select = url.searchParams.get('select');
      const isCompanion = select === 'time_zone,calorie_target,protein_grams,fat_grams' || select === 'calories,protein,fat' || select === 'is_baseline';
      // A mismatched getUser fixture also affects the pre-existing Dashboard reader.
      if (!badOwner || isCompanion) assert.equal(url.searchParams.get('user_id'), `eq.${owner}`, 'every companion read is owner scoped');
      scopedReads.push({ table, select: url.searchParams.get('select') });
      if (fail) return route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"TEST DATA context unavailable"}' });
      if (table === 'weight_logs') {
        assert.equal(url.searchParams.get('is_baseline'), 'eq.false');
        assert.equal(url.searchParams.getAll('measured_at').length, 2, 'check-in read has both local-day boundaries');
      }
      const goal = { user_id: owner, calorie_target: 2000, protein_grams: 130, carbs_grams: 250, fat_grams: 60, time_zone: 'Asia/Manila' };
      const foods = calories.map((calories, i) => ({ id: `fixture-${i}`, name: 'TEST DATA meal', user_id: owner, calories, protein: 0, carbs: 0, fat: 0, ...macros[i], created_at: now.toISOString() }));
      const body = table === 'user_goals' ? goal : table === 'weight_logs' ? checkedIn ? [{ is_baseline: false, local_date: day }] : [] : foods;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
  }
  if (badOwner) await page.route('**/auth/v1/user*', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: '99999999-9999-4999-8999-999999999999' }) }));
  return { fixture, scopedReads };
}
const mascot = page => page.locator('[data-testid^="bee-mascot-"]:visible');
async function sample(locator) {
  const values = [];
  for (let i = 0; i < 5; i++) {
    values.push(await locator.evaluate(el => getComputedStyle(el).transform));
    await new Promise(resolve => setTimeout(resolve, 160));
  }
  return new Set(values);
}
async function exercise(browser, base, width) {
  const context = await browser.newContext({ viewport: { width, height: 950 } });
  const page = await context.newPage();
  const errors = [], failures = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('requestfailed', request => { if (request.failure()?.errorText !== 'net::ERR_ABORTED') failures.push(request.url()); });
  const { fixture } = await install(page);
  await page.goto(base);
  await page.locator('[data-testid="bee-mascot-encouraging"]').waitFor();
  assert.equal(await mascot(page).count(), 1, 'one companion on the dashboard');
  const apiCount = () => fixture.requests.filter(req => req.path.endsWith('/bee-chat')).length;
  await page.waitForTimeout(500);
  const before = apiCount();
  assert.ok((await sample(mascot(page))).size > 1, 'Bee moves without rendering another page');
  assert.equal(apiCount(), before, 'animation never calls an AI service');
  await page.screenshot({ path: `${output}/dashboard-${width}.png`, fullPage: true });
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForTimeout(200);
  assert.equal((await sample(mascot(page))).size, 1, 'background tab stops animation');
  await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
  await page.locator('[data-testid="bee-mascot-encouraging"]').waitFor();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForTimeout(200);
  assert.equal((await sample(mascot(page))).size, 1, 'changed OS setting stops movement immediately');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const dashboardChat = page.getByRole('button', { name: 'Open Bee quick log', exact: true });
  assert.equal(await dashboardChat.isVisible(), true, 'dashboard keeps a bottom-right chat entry point');
  assert.equal(await dashboardChat.locator('[data-testid^="bee-mascot-"]').count(), 0, 'chat shortcut does not duplicate the dashboard mascot');
  const bounds = await dashboardChat.boundingBox();
  assert.ok(bounds.x >= width - 110 && bounds.y >= 740 && bounds.y + bounds.height <= 950, 'chat shortcut stays in the bottom-right viewport above mobile navigation');
  assert.equal(await page.getByTestId('bee-dashboard-companion').locator('[data-testid^="bee-mascot-"]').count(), 1, 'Bee belongs to the dashboard');
  assert.equal(await mascot(page).evaluate(el => parseFloat(getComputedStyle(el).width)), 116, 'dashboard Bee has a larger full-body slot');
  const launcher = page.getByRole('button', { name: 'Open Bee chat', exact: true });
  await dashboardChat.focus();
  await page.waitForFunction(() => {
    const button = document.querySelector('[aria-label="Open Bee quick log"]');
    if (!button) return false;
    const style = getComputedStyle(button);
    return style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 2;
  });
  await dashboardChat.press('Enter');
  await page.getByRole('dialog', { name: 'Bee conversation', exact: true }).waitFor();
  await dashboardChat.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Close Bee quick log', exact: true }).click();
  await page.getByRole('dialog', { name: 'Bee conversation', exact: true }).waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Bee encourages your first food log', exact: true }).press('Enter');
  await page.getByRole('button', { name: 'Pause Bee motion', exact: true }).click();
  await page.getByRole('button', { name: 'Animate Bee', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Close Bee quick log', exact: true }).click();
  // Closing the sheet remounts the dashboard mascot in a React effect. The
  // launcher is already visible behind the sheet, so it cannot signal readiness.
  await page.getByRole('dialog', { name: 'Bee conversation', exact: true }).waitFor({ state: 'hidden' });
  const dashboardMascot = page.getByTestId('bee-dashboard-companion').locator('[data-testid^="bee-mascot-"]');
  await dashboardMascot.waitFor();
  await launcher.waitFor();
  assert.equal((await sample(dashboardMascot)).size, 1, 'pause stops transforms');
  await page.reload();
  await page.locator('[data-testid="bee-mascot-encouraging"]').waitFor();
  assert.equal((await sample(mascot(page))).size, 1, 'device preference survives reload');
  await launcher.click();
  await page.getByRole('button', { name: 'Animate Bee', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Message to Bee', exact: true });
  await input.fill('72 g boiled egg');
  await page.getByRole('button', { name: 'Send to Bee', exact: true }).click();
  await page.locator('[data-testid="bee-mascot-thinking"] img[src*="bee-thinking."]').waitFor();
  await page.waitForTimeout(250);
  assert.equal(await mascot(page).count(), 1, 'header and transcript do not repeat the mascot');
  await page.screenshot({ path: `${output}/review-${width}.png`, fullPage: true });
  await page.getByRole('button', { name: 'Close Bee quick log', exact: true }).click();
  await page.locator('[data-testid="bee-mascot-thinking"]').waitFor();
  await launcher.click();
  await page.getByRole('button', { name: 'Add to today', exact: true }).click();
  await page.getByText("Added to today's food log.", { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Close Bee quick log', exact: true }).click();
  await page.locator('[data-testid="bee-mascot-celebrating"]').waitFor();
  await page.screenshot({ path: `${output}/confirmed-${width}.png`, fullPage: true });
  // Existing form guide becomes text; there is still one shared companion.
  await page.goto(`${base}/create-food`);
  await page.getByRole('textbox', { name: 'Food name', exact: true }).waitFor();
  await page.getByRole('textbox', { name: 'Food name', exact: true }).blur();
  await mascot(page).waitFor();
  assert.equal(await mascot(page).count(), 1);
  await page.getByRole('textbox', { name: 'Food name', exact: true }).focus();
  const floating = page.getByRole('button', { name: 'Open Bee quick log', exact: true });
  await floating.waitFor({ state: 'hidden' });
  assert.equal(await floating.count(), 0, 'companion does not cover focused forms');
  await page.getByRole('textbox', { name: 'Food name', exact: true }).blur();
  await launcher.waitFor();
  await page.screenshot({ path: `${output}/form-${width}.png`, fullPage: true });
  assert.deepEqual(errors, []);
  assert.deepEqual(failures, []);
  await context.close();
}
async function accountSwitch(browser, base) {
  const page = await browser.newPage({ viewport: { width: 375, height: 950 }, reducedMotion: 'reduce' });
  await install(page);
  const otherOwner = '99999999-9999-4999-8999-999999999999';
  await page.addInitScript(({ otherOwner }) => {
    const original = Storage.prototype.getItem;
    window.__beeOtherAccount = false;
    Storage.prototype.getItem = function(key) {
      const value = original.call(this, key);
      if (!/^sb-.*-auth-token$/.test(key) || !value) return value;
      window.__beeAuthKey = key;
      if (!window.__beeOtherAccount) return value;
      const session = JSON.parse(value);
      const encode = value => btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
      const payload = JSON.parse(atob(session.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      payload.sub = otherOwner;
      session.access_token = `${session.access_token.split('.')[0]}.${encode(payload)}.browser-fixture`;
      session.user.id = otherOwner;
      session.user.email = 'second-fixture@example.test';
      return JSON.stringify(session);
    };
  }, { otherOwner });
  await page.route('**/auth/v1/user*', async route => {
    const changed = await page.evaluate(() => window.__beeOtherAccount);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: changed ? otherOwner : owner, aud: 'authenticated', role: 'authenticated', email: 'account-fixture@example.test' }) });
  });
  const reads = [];
  for (const table of ['user_goals', 'food_logs', 'weight_logs']) await page.route(`**/rest/v1/${table}**`, route => {
    const url = new URL(route.request().url());
    const userId = url.searchParams.get('user_id')?.replace(/^eq\./, '');
    assert.ok([owner, otherOwner].includes(userId));
    assert.equal(route.request().method(), 'GET');
    reads.push({ table, userId });
    const second = userId === otherOwner;
    const body = table === 'user_goals' ? { user_id: userId, time_zone: 'Asia/Manila', calorie_target: second ? 1000 : 2000 } : table === 'food_logs' && second ? [{ calories: 950, name: 'TEST DATA second account meal', created_at: now.toISOString(), user_id: userId }] : [];
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.route('**/functions/v1/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":false,"error":"not_configured"}' }));
  await page.goto(base);
  await page.locator('[data-testid="bee-mascot-encouraging"]').waitFor();
  await page.evaluate(() => {
    window.__beeOtherAccount = true;
    const key = window.__beeAuthKey;
    const session = JSON.parse(localStorage.getItem(key));
    const channel = new BroadcastChannel(key);
    channel.postMessage({ event: 'SIGNED_IN', session });
    setTimeout(() => channel.close(), 100);
  });
  await page.locator('[data-testid="bee-mascot-success"] img[src*="bee-success."]').waitFor();
  assert.equal(await page.locator('[data-testid="bee-mascot-encouraging"]').count(), 0, 'previous account pose is cleared');
  assert.ok(reads.some(read => read.userId === otherOwner && read.table === 'food_logs'));
  assert.equal(await mascot(page).count(), 1);
  await page.evaluate(() => {
    const channel = new BroadcastChannel(window.__beeAuthKey);
    channel.postMessage({ event: 'SIGNED_OUT', session: null });
    setTimeout(() => channel.close(), 100);
  });
  await page.getByTestId('bee-dashboard-companion').waitFor({ state: 'hidden' });
  assert.equal(await mascot(page).count(), 0, 'sign-out removes the private companion');
  await page.close();
}

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const local = process.env.UI_BASE_URL ? null : await require('./serve-web-export.cjs').serveExport();
  const base = process.env.UI_BASE_URL || local.base;
  const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN, headless: true });
  try {
    for (const width of [375, 768, 1440]) { console.log(`Checking Bee at ${width}px`); await exercise(browser, base, width); }
    for (const [name, setup, expected] of [
      ['recorded-food', { calories: [500] }, 'encouraging'],
      ['near-target', { calories: [1900] }, 'success'],
      ['over-target', { calories: [2500] }, 'resting'],
      ['actual-check-in', { checkedIn: true }, 'success'],
      ['protein-ideas', { calories: [600, 600], macros: [{ protein: 15, fat: 10 }, { protein: 15, fat: 10 }] }, 'encouraging'],
      ['fat-review', { calories: [1200, 100], macros: [{ protein: 10, fat: 74 }, { protein: 5, fat: 0 }] }, 'thinking'],
      ['unknown-macros', { calories: [600, 600], macros: [{ protein: null, fat: null }, { protein: 5, fat: 0 }] }, 'encouraging'],
      ['unavailable', { fail: true }, 'greeting'],
      ['wrong-verified-owner', { badOwner: true }, 'greeting'],
    ]) {
      const page = await browser.newPage({ viewport: { width: 375, height: 950 }, reducedMotion: 'reduce' });
      const { scopedReads } = await install(page, setup);
      await page.goto(base);
      const bee = page.locator(`[data-testid="bee-mascot-${expected}"]`);
      await bee.waitFor();
      await page.waitForTimeout(500);
      await bee.locator(`img[src*="bee-${expected}."]`).waitFor();
      if (setup.badOwner) assert.equal(scopedReads.filter(read => read.select === 'time_zone,calorie_target,protein_grams,fat_grams').length, 0, 'wrong verified owner cannot read companion context');
      assert.equal(await mascot(page).count(), 1);
      if (name === 'protein-ideas') await page.getByText('30 of 130 g protein recorded. Ask Bee for ideas that fit you.', { exact: true }).waitFor();
      if (name === 'fat-review') await page.getByText('74 g fat recorded; your saved target is 60 g. Ask Bee to review.', { exact: true }).waitFor();
      if (name === 'unknown-macros') assert.equal(await page.getByText(/Ask Bee for ideas that fit you|Ask Bee to review/).count(), 0);
      assert.equal((await sample(bee)).size, 1, 'OS reduced-motion preference overrides animation');
      await page.screenshot({ path: `${output}/${name}.png`, fullPage: true });
      await page.close();
    }
    await accountSwitch(browser, base);
    console.log('Bee motion PASS: 375/768/1440, single companion, real-state fixtures, review pose, pause/reload, reduced motion, owner scoping/account switch/sign-out, no animation API calls, zero unexpected console/network errors. TEST DATA only.');
  } finally { await browser.close(); if (local) await new Promise(resolve => local.server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
