// Controlled TEST DATA only: every account, diary entry and generated reply is fake.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const owner = '11111111-1111-4111-8111-111111111111';
const fallback = 'Review your diary, log a food, or record a weigh-in. Tap Bee to ask for help.';
const output = 'output/playwright/bee-insight';
const day = now => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(now);
const card = page => page.getByTestId('bee-dashboard-companion');

async function install(page, tier = 'pro') {
  await require('./fixtures/bee-browser.cjs')(page);
  const state = {
    now: new Date('2026-11-08T15:59:55Z'), revision: 1, tier, fail: false, owner,
    calls: [], generated: [], entitlementChecks: [], failedRevisions: [], cached: null, pendingSave: null, holdInsight: false, pendingInsight: null,
    log: { id: 'fixture-log', user_id: owner, name: 'TEST DATA meal', serving_size: '100', serving_unit: 'g', calories: 500, protein: 25, carbs: 60, fat: 10, created_at: '2026-11-08T10:00:00Z' },
  };
  await page.clock.install({ time: state.now });
  const json = (route, value) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });
  await page.route('**/rest/v1/**', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname.endsWith('/rpc/account_entitlement')) {
      state.entitlementChecks.push(state.tier);
      return json(route, { tier: state.tier });
    }
    if (url.pathname.endsWith('/user_goals')) return json(route, { user_id: state.owner, age: 30, calorie_target: 2000, protein_grams: 130, carbs_grams: 250, fat_grams: 60, time_zone: 'Asia/Manila' });
    if (!url.pathname.endsWith('/food_logs')) return route.fallback();
    assert.equal(url.searchParams.get('user_id'), `eq.${state.owner}`, 'diary reads and saves are owner scoped');
    if (request.method() === 'PATCH') {
      const update = request.postDataJSON();
      // Hold the write so an optimistic render cannot masquerade as persisted context.
      state.pendingSave = async () => {
        state.log = { ...state.log, ...update };
        state.revision++;
        state.pendingSave = null;
        await json(route, null);
      };
      return;
    }
    assert.equal(request.method(), 'GET', 'the test never submits a real mutation');
    return json(route, state.owner === owner && day(state.now) === day(new Date(state.log.created_at)) ? [state.log] : []);
  });
  await page.route('**/functions/v1/bee-chat', async route => {
    const request = route.request().postDataJSON();
    if (request.command.kind !== 'insight') return route.fallback();
    state.calls.push(request);
    assert.equal(request.command.refresh, undefined, 'automatic checks use the server cache');
    if (state.fail) {
      const revision = state.revision;
      await json(route, { ok: false, error: 'provider_unavailable' });
      state.failedRevisions.push(revision);
      return;
    }
    const localDay = day(state.now), key = `${state.revision}:${localDay}`;
    if (!state.cached || state.cached.key !== key || Date.parse(state.cached.insight.expires_at) <= state.now.getTime()) {
      const calories = localDay === day(new Date(state.log.created_at)) ? state.log.calories : 0;
      // Fake provider returns distinct prose/next steps from persisted fixture context.
      const text = calories >= 500
        ? `TEST DATA ${localDay}: ${calories} kcal recorded. Review the foods already in your diary.`
        : calories > 0
          ? `TEST DATA ${localDay}: Your smaller portion records ${calories} kcal. Check the next meal you want to log.`
          : `TEST DATA ${localDay}: No food is recorded today. Start by logging your first meal.`;
      const expires = new Date(`${localDay}T16:00:00Z`);
      state.cached = { key, insight: { text, context_revision: String(state.revision), suggested_pose: 'encouraging', expires_at: expires.toISOString() } };
      state.generated.push({ key, calories, text });
    }
    const result = { ok: true, snapshot: { thread: { id: '22222222-2222-4222-8222-222222222222', version: 0 }, messages: [], memories: [], profile: { age: 30 }, pending: null, insight: state.cached.insight } };
    if (state.holdInsight) { state.pendingInsight = () => json(route, result); return; }
    return json(route, result);
  });
  return state;
}

async function until(predicate, message) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.fail(message);
}

async function editPortion(page, amount) {
  await page.getByText('TEST DATA meal', { exact: true }).click();
  await page.getByText('Edit Portion', { exact: true }).waitFor();
  await page.getByRole('textbox').fill(String(amount));
  await page.getByText('Save Changes', { exact: true }).click();
}

async function exercise(browser, base, width, scenario) {
  const context = await browser.newContext({ viewport: { width, height: 950 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [], failed = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('requestfailed', request => { if (request.failure()?.errorText !== 'net::ERR_ABORTED') failed.push(request.url()); });
  const state = await install(page);
  try {
    await page.goto(base);
    await card(page).getByText(/500 kcal recorded/).waitFor();
    await page.waitForTimeout(250);
    assert.equal(state.generated.length, 1, 'unchanged revision/day is generated only once');
    const stableCalls = state.calls.length;
    await page.getByRole('button', { name: 'Open Bee chat', exact: true }).click();
    await page.getByRole('dialog', { name: 'Bee conversation', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Close Bee quick log', exact: true }).click();
    await page.getByRole('dialog', { name: 'Bee conversation', exact: true }).waitFor({ state: 'hidden' });
    await page.waitForTimeout(250);
    assert.equal(state.calls.length, stableCalls, 'chat taps and mascot renders never request another insight');
    await page.screenshot({ path: `${output}/initial-${width}-${scenario}.png`, fullPage: true });

    if (scenario === 'saved-data') {
      await editPortion(page, 50);
      await until(() => state.pendingSave, 'portion save reached the controlled server');
      await page.waitForTimeout(250); // Let any premature optimistic request complete first.
      await state.pendingSave();
      await card(page).getByText(/smaller portion records 250 kcal/).waitFor();
      assert.equal(state.generated.at(-1).calories, 250, 'advice uses the successfully saved portion');
      assert.notEqual(state.generated[0].text, state.generated.at(-1).text, 'different diary context changes wording and next step');
      await card(page).scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${output}/changed-${width}.png`, fullPage: true });

      state.fail = true;
      await editPortion(page, 25);
      await until(() => state.pendingSave, 'second portion save reached the controlled server');
      await state.pendingSave();
      await until(() => state.failedRevisions.includes(state.revision), 'failed refresh completed for the newly persisted revision');
      await card(page).getByText(fallback, { exact: true }).waitFor();
      assert.equal(await card(page).getByText(/smaller portion records 250 kcal/).count(), 0, 'failed refresh clears old-context advice');
      const failedCalls = state.calls.length;
      state.now = new Date(state.now.getTime() + 300_000);
      await page.clock.fastForward(300_000);
      await page.waitForTimeout(100);
      assert.equal(state.calls.length, failedCalls, 'provider failure never starts an automatic retry loop');
      await page.screenshot({ path: `${output}/fallback-${width}.png`, fullPage: true });
    } else {
      state.now = new Date('2026-11-08T16:00:01Z');
      await page.clock.fastForward(6000);
      await card(page).getByText(/2026-11-09: No food is recorded today/).waitFor();
      await page.getByText('Today, Mon, Nov 9', { exact: true }).waitFor({ timeout: 3000 });
      await page.getByText('Consumed', { exact: true }).locator('..').getByText('0', { exact: true }).waitFor();
      await page.getByText('Plate is empty', { exact: true }).waitFor();
      assert.equal(await page.getByText('TEST DATA meal', { exact: true }).count(), 0, 'dashboard clears yesterday’s diary at the same rollover');
      assert.equal(state.generated.length, 2, 'local midnight expires the previous day and generates one fresh insight');
      assert.equal(state.calls.length, stableCalls + 1, 'expiry causes one cache check without render polling');
      await page.screenshot({ path: `${output}/next-day-${width}.png`, fullPage: true });
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(failed, []);
  } finally { await context.close(); }
}

async function checkBeeInsight(browser, base) {
  fs.mkdirSync(output, { recursive: true });
  const only = process.env.BEE_INSIGHT_SCENARIO;
  for (const width of [375, 768, 1440]) {
    for (const scenario of only ? [only] : ['saved-data', 'expiry']) await exercise(browser, base, width, scenario);
  }
  for (const tier of ['basic', 'plus']) {
    const page = await browser.newPage({ viewport: { width: 375, height: 950 }, reducedMotion: 'reduce' });
    const state = await install(page, tier);
    await page.goto(base);
    await card(page).getByText(fallback, { exact: true }).waitFor();
    await page.waitForTimeout(250);
    assert.equal(state.calls.length, 0, `${tier} keeps manual tracking without requesting a Pro insight`);
    await page.close();
  }
  await accountChange(browser, base);
  console.log('Bee insight PASS: varied persisted contexts, revision/day cache, finite expiry, failed refresh fallback, no render/tap calls or retry loops, Basic/Plus boundaries and late-response account isolation; 375/768/1440. TEST DATA only.');
}

async function accountChange(browser, base) {
  const page = await browser.newPage({ viewport: { width: 375, height: 950 }, reducedMotion: 'reduce' });
  const state = await install(page);
  const otherOwner = '99999999-9999-4999-8999-999999999999';
  await page.addInitScript(({ otherOwner }) => {
    const original = Storage.prototype.getItem;
    window.__insightOtherAccount = false;
    Storage.prototype.getItem = function(key) {
      const value = original.call(this, key);
      if (!/^sb-.*-auth-token$/.test(key) || !value) return value;
      window.__insightAuthKey = key;
      if (!window.__insightOtherAccount) return value;
      const session = JSON.parse(value);
      // Only this fixture's artificial session exists in this isolated browser.
      const encode = value => btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
      const payload = JSON.parse(atob(session.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      payload.sub = otherOwner;
      session.access_token = `${session.access_token.split('.')[0]}.${encode(payload)}.browser-fixture`;
      session.user.id = otherOwner;
      return JSON.stringify(session);
    };
  }, { otherOwner });
  await page.route('**/auth/v1/user*', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: state.owner, aud: 'authenticated', role: 'authenticated' }) }));
  try {
    await page.goto(base);
    await card(page).getByText(/500 kcal recorded/).waitFor();
    await page.waitForTimeout(250);
    state.holdInsight = true;
    await editPortion(page, 50);
    await until(() => state.pendingSave, 'first account portion save reached the controlled server');
    await state.pendingSave();
    await until(() => state.pendingInsight && state.generated.at(-1).calories === 250, 'first account updated insight is held in flight');
    await page.waitForTimeout(250);
    state.owner = otherOwner;
    state.tier = 'basic';
    await page.evaluate(() => {
      window.__insightOtherAccount = true;
      const key = window.__insightAuthKey;
      const channel = new BroadcastChannel(key);
      channel.postMessage({ event: 'SIGNED_IN', session: JSON.parse(localStorage.getItem(key)) });
      setTimeout(() => channel.close(), 100);
    });
    await until(() => state.entitlementChecks.includes('basic'), 'new account entitlement replaces the previous owner');
    await card(page).getByText(fallback, { exact: true }).waitFor();
    await state.pendingInsight();
    await page.waitForTimeout(250);
    assert.equal(await card(page).getByText(/500 kcal recorded|smaller portion records 250 kcal/).count(), 0, 'old and late advice from the previous owner stays discarded');
    const calls = state.calls.length;
    await page.clock.fastForward(6000);
    await page.waitForTimeout(100);
    assert.equal(state.calls.length, calls, 'account change cancels the previous insight timer');
  } finally { await page.close(); }
}

module.exports = checkBeeInsight;
if (require.main === module) {
  (async () => {
    const local = process.env.UI_BASE_URL ? null : await require('./serve-web-export.cjs').serveExport();
    const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN, headless: true });
    try { await checkBeeInsight(browser, process.env.UI_BASE_URL || local.base); }
    finally { await browser.close(); if (local) await new Promise(resolve => local.server.close(resolve)); }
  })().catch(error => { console.error(error); process.exitCode = 1; });
}
