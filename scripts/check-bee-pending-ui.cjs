// Synthetic TEST DATA only. All Auth, database, and provider calls are intercepted.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { fixtureEvent } = require('./fixtures/bee-browser.cjs');
const output = 'output/playwright/bee-pending';
const owner = '11111111-1111-4111-8111-111111111111';
const otherOwner = '99999999-9999-4999-8999-999999999999';

async function verify(browser, base, width) {
  fs.mkdirSync(output, { recursive: true });
  const context = await browser.newContext({ viewport: { width, height: 950 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const errors = [], failures = [], calls = [], releases = new Set();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('requestfailed', request => { if (!request.failure()?.errorText?.includes('ERR_ABORTED')) failures.push(request.url()); });
  const fixture = await require('./fixtures/bee-browser.cjs')(page);
  const snapshots = new Map([[owner, fixture.getSnapshot()], [otherOwner, fixture.getSnapshot()]]);
  snapshots.get(otherOwner).thread.id = '22222222-2222-4222-8222-222222222299';
  let currentOwner = owner, nextReply = null, sequence = 0;
  const completed = new Map();
  const json = (route, body) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });

  // This isolated context contains artificial sessions only; never inspect a real profile.
  await page.addInitScript(({ owner }) => {
    const original = Storage.prototype.getItem;
    window.__beePendingOwner = owner;
    window.__beePendingSession = id => {
      if (!id) return null;
      const exp = Math.floor(Date.now() / 1000) + 86400;
      const encode = value => btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
      return {
        access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: id, exp, aud: 'authenticated', role: 'authenticated' })}.browser-fixture`,
        refresh_token: 'browser-fixture', expires_at: exp, expires_in: 86400, token_type: 'bearer',
        user: { id, aud: 'authenticated', role: 'authenticated', email: 'pending-fixture@example.test', app_metadata: {}, user_metadata: {}, identities: [], created_at: '2026-09-26T00:00:00Z' },
      };
    };
    Storage.prototype.getItem = function(key) {
      if (!/^sb-.*-auth-token$/.test(key)) return original.call(this, key);
      window.__beePendingAuthKey = key;
      const session = window.__beePendingSession(window.__beePendingOwner);
      return session ? JSON.stringify(session) : null;
    };
  }, { owner });
  await page.route('**/auth/v1/**', route => json(route, { id: currentOwner, aud: 'authenticated', role: 'authenticated', email: 'pending-fixture@example.test' }));
  await page.route('**/rest/v1/rpc/account_entitlement', route => json(route, snapshots.get(currentOwner).entitlement));
  await page.route('**/functions/v1/bee-chat', async route => {
    const request = route.request().postDataJSON(), command = request.command;
    calls.push(request);
    const snapshot = snapshots.get(currentOwner);
    if (command.kind === 'message' || command.kind === 'food_assist') {
      const reply = nextReply;
      assert.ok(reply, 'every message has an explicit held response');
      nextReply = null;
      const held = new Promise(resolve => {
        reply.release = () => { releases.delete(reply.release); resolve(); };
        releases.add(reply.release);
        reply.started.signal();
      });
      await held;
      if (reply.outcome === 'failure') return json(route, { ok: false, error: 'provider_unavailable' });
      if (!completed.has(request.requestId)) {
        snapshot.thread.version++;
        snapshot.messages.push(
          { id: 'pending-user-' + ++sequence, role: 'user', text: command.text, created_at: new Date().toISOString() },
          { id: 'pending-assistant-' + ++sequence, role: 'assistant', text: 'TEST DATA response ' + sequence + ': tell me the portion before reviewing food.', created_at: new Date().toISOString() },
        );
        completed.set(request.requestId, structuredClone(snapshot));
      }
      // Model a committed turn whose response was lost, with no real network failure.
      if (reply.outcome === 'lost_response') return json(route, { ok: false, error: 'offline' });
      return json(route, { ok: true, snapshot: completed.get(request.requestId) });
    }
    if (command.kind === 'new_thread') {
      snapshot.thread = { id: '22222222-2222-4222-8222-222222222233', version: 0 };
      snapshot.messages = [];
      snapshot.pending = null;
    }
    return json(route, { ok: true, snapshot });
  });

  const button = name => page.getByRole('button', { name, exact: true });
  const input = page.getByRole('textbox', { name: 'Message to Bee', exact: true });
  const dialog = page.getByRole('dialog', { name: 'Bee conversation', exact: true });
  const messageText = text => dialog.getByText(text, { exact: true }).and(page.locator(':not(textarea):not(input)'));
  const hold = outcome => {
    const reply = { outcome, started: fixtureEvent('pending ' + outcome), release: null };
    nextReply = reply;
    return reply;
  };
  const assertPending = async (text, label, expectedDraft = '') => {
    await page.screenshot({ path: `${output}/${label}-${width}.png`, fullPage: true, animations: 'disabled' });
    assert.equal(await dialog.getByTestId('bee-outgoing-message').count(), 1, 'a pending user bubble appears before the held response');
    assert.equal(await messageText(text).count(), 1, 'outgoing text appears exactly once before the held response');
    assert.equal(await input.inputValue(), expectedDraft, 'accepted sends clear only their matching composer draft');
    assert.equal(await dialog.getByText('Sending…', { exact: true }).count(), 1, 'the outgoing bubble clearly marks its pending state');
    assert.equal(await button('Send to Bee').isDisabled(), true, 'the same turn cannot be sent twice');
    assert.equal(await button('New conversation').isDisabled(), true, 'a pending turn cannot be moved to another thread');
    assert.equal(await dialog.getByText("Added to today's food log.", { exact: true }).count(), 0, 'sending a message never claims to save food');
    const textBox = await messageText(text).boundingBox(), sheetBox = await dialog.boundingBox();
    assert.ok(textBox.x >= sheetBox.x && textBox.x + textBox.width <= sheetBox.x + sheetBox.width, 'pending text wraps inside the sheet');
  };
  const assertSettled = async text => {
    await dialog.getByText('Sending…', { exact: true }).waitFor({ state: 'hidden' });
    assert.equal(await messageText(text).count(), 1, 'the server transcript replaces the transient bubble without a duplicate');
  };
  const switchIdentity = async id => {
    currentOwner = id;
    await page.evaluate(id => {
      window.__beePendingOwner = id;
      const channel = new BroadcastChannel(window.__beePendingAuthKey);
      channel.postMessage({ event: id ? 'SIGNED_IN' : 'SIGNED_OUT', session: window.__beePendingSession(id) });
      setTimeout(() => channel.close(), 100);
    }, id);
  };

  try {
    await page.goto(base);
    await button('Open Bee chat').click();
    await input.waitFor();
    await button('New conversation').waitFor({ state: 'visible' });
    const firstText = 'TEST DATA: I ate one chocolate Fudgee Barr and want to check the portion before logging it.';
    let reply = hold('success');
    await input.fill(firstText); await button('Send to Bee').click(); await reply.started.wait();
    await assertPending(firstText, 'sending');
    await button('Close Bee quick log').click();
    await button('Open Bee chat').click();
    await assertPending(firstText, 'sending-reopened');
    reply.release(); await assertSettled(firstText);
    assert.equal(await input.inputValue(), '');
    await page.screenshot({ path: `${output}/sent-${width}.png`, fullPage: true, animations: 'disabled' });

    const failedText = 'TEST DATA: check a different food';
    reply = hold('failure');
    await input.fill(failedText); await button('Send to Bee').click(); await reply.started.wait();
    await assertPending(failedText, 'sending-before-failure');
    reply.release(); await button('Retry').waitFor();
    assert.equal(await input.inputValue(), failedText, 'failed message text is restored for editing');
    assert.equal(await messageText(failedText).count(), 0, 'failed text is not left in a completed-looking bubble');
    await page.screenshot({ path: `${output}/recoverable-failure-${width}.png`, fullPage: true, animations: 'disabled' });
    const differentDraft = 'TEST DATA unsent follow-up';
    await input.fill(differentDraft);
    reply = hold('success'); await button('Retry').click(); await reply.started.wait();
    await assertPending(failedText, 'retry-with-unsent-draft', differentDraft);
    reply.release(); await assertSettled(failedText);
    assert.equal(await input.inputValue(), differentDraft, 'retry never erases a different unsent draft');
    const failedAttempts = calls.filter(call => call.command.text === failedText);
    assert.equal(failedAttempts.length, 2);
    assert.notEqual(failedAttempts[0].requestId, failedAttempts[1].requestId, 'completed provider failure refreshes before a new attempt');

    const lostText = 'TEST DATA food assistance with a lost reply';
    snapshots.get(owner).entitlement.tier = 'plus';
    await button('Close Bee quick log').click(); await button('Open Bee chat').click();
    await dialog.getByText('Opening your conversation…', { exact: true }).waitFor({ state: 'hidden' });
    reply = hold('lost_response');
    await input.fill(lostText); await button('Send to Bee').click(); await reply.started.wait();
    await assertPending(lostText, 'food-assist-sending');
    reply.release(); await button('Retry').waitFor();
    assert.equal(await input.inputValue(), lostText);
    reply = hold('success'); await button('Retry').click(); await reply.started.wait();
    await assertPending(lostText, 'replay-sending');
    reply.release(); await assertSettled(lostText);
    assert.equal(await input.inputValue(), '');
    const lostAttempts = calls.filter(call => call.command.text === lostText);
    assert.equal(lostAttempts.length, 2);
    assert.equal(lostAttempts[0].command.kind, 'food_assist');
    assert.deepEqual(lostAttempts[0], lostAttempts[1], 'response-loss retry retains the entire idempotent request');
    assert.equal(snapshots.get(owner).messages.filter(message => message.text === lostText).length, 1, 'replay creates no server duplicate');

    await button('New conversation').click(); await button('Start new').click();
    await dialog.getByText('New conversation started. Your saved preferences are still available.', { exact: true }).waitFor();
    assert.equal(await dialog.getByText(firstText, { exact: true }).count(), 0, 'new thread removes old transcript and pending display');
    assert.equal(await input.inputValue(), '');
    const privateText = 'TEST DATA old account message in flight';
    reply = hold('success');
    await input.fill(privateText); await button('Send to Bee').click(); await reply.started.wait();
    await assertPending(privateText, 'before-account-switch');
    await switchIdentity(otherOwner); await dialog.waitFor({ state: 'hidden' });
    reply.release();
    await button('Open Bee chat').click(); await input.waitFor();
    await dialog.getByText('Opening your conversation…', { exact: true }).waitFor({ state: 'hidden' });
    assert.equal(await dialog.getByText(privateText, { exact: true }).count(), 0, 'old account text and late response never appear for the next account');
    assert.equal(await input.inputValue(), '');
    assert.equal(await dialog.getByText('Sending…', { exact: true }).count(), 0);

    const signedOutText = 'TEST DATA pending at sign-out';
    reply = hold('success');
    await input.fill(signedOutText); await button('Send to Bee').click(); await reply.started.wait();
    await assertPending(signedOutText, 'before-sign-out');
    await switchIdentity(null); await dialog.waitFor({ state: 'hidden' });
    reply.release(); await page.getByRole('button', { name: 'Forgot password?', exact: true }).waitFor();
    assert.equal(await page.getByText(signedOutText, { exact: true }).count(), 0, 'sign-out clears the pending message');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    assert.equal(calls.filter(call => call.command.kind === 'confirm').length, 0);
    assert.equal(fixture.requests.filter(request => request.path === '/rest/v1/food_logs' && request.method !== 'GET').length, 0);
    assert.deepEqual(errors, []); assert.deepEqual(failures, []);
    return { width, immediateBubbleAndEmptyComposer: true, successWithoutDuplicate: true, failureTextRecovered: true, retryPreservesOtherDraft: true, responseLossReplay: true, foodAssist: true, closeReopen: true, newThreadIsolation: true, accountSwitchAndSignOut: true, foodWrites: 0, consoleErrors: 0, failedRequests: 0 };
  } catch (error) {
    await page.screenshot({ path: `${output}/failure-${width}.png`, fullPage: true });
    throw error;
  } finally {
    releases.forEach(release => release());
    await context.close();
  }
}

module.exports = { verify };
if (require.main === module) (async () => {
  const local = process.env.UI_BASE_URL ? null : await require('./serve-web-export.cjs').serveExport();
  const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || chromium.executablePath(), headless: true, args: ['--no-sandbox'] });
  const results = [];
  try { for (const width of [375, 768, 1440]) results.push(await verify(browser, process.env.UI_BASE_URL || local.base, width)); }
  finally { await browser.close(); if (local) { local.server.closeAllConnections(); await new Promise(resolve => local.server.close(resolve)); } }
  fs.writeFileSync(`${output}/results.json`, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
})().catch(error => { console.error(error); process.exitCode = 1; });
