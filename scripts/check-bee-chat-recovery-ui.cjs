// Synthetic TEST DATA only. All Supabase calls are intercepted by the fixture.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { fixtureEvent } = require('./fixtures/bee-browser.cjs');
const output = 'output/playwright/bee-chat-recovery';

async function verify(browser, base, width) {
  fs.mkdirSync(output, { recursive: true });
  const context = await browser.newContext({ viewport: { width, height: 950 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [], failures = [], calls = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('requestfailed', request => { if (!request.failure()?.errorText?.includes('ERR_ABORTED')) failures.push(request.url()); });
  const fixture = await require('./fixtures/bee-browser.cjs')(page);
  const snapshot = fixture.getSnapshot();
  snapshot.entitlement.tier = 'basic';
  const nutrients = { calories: 100, protein: 10, carbs: 2, fat: 4 };
  snapshot.pending = {
    kind: 'food', id: '33333333-3333-4333-8333-333333333333', thread_id: snapshot.thread.id,
    review_version: snapshot.thread.version, status: 'pending', expires_at: '2099-01-01T00:00:00Z',
    local_date: new Date().toLocaleDateString('en-CA'), time_zone: 'Asia/Manila',
    food: { name: 'TEST DATA reviewed food', source: 'user_label', servingLabel: '100 g', grams: 100, ...nutrients,
      evidence: { url: '', title: 'TEST DATA label', identity: 'TEST DATA reviewed food', retrievedAt: new Date().toISOString(), excerpt: 'Synthetic label', record: 'user_owned', basis: { grams: 100, unit: 'g', count: null, milliliters: null, nutrients } } },
  };
  snapshot.messages = [{ id: 'existing-review', role: 'assistant', text: 'TEST DATA: review from an earlier conversation.', created_at: new Date().toISOString(), draft: snapshot.pending }];
  const fulfill = (route, body) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  const initialLoad = fixtureEvent('initial conversation load');
  let releaseInitialLoad, releaseManagement, managementStarted, loadCount = 0;
  await page.route('**/rest/v1/rpc/account_entitlement', route => fulfill(route, snapshot.entitlement));
  await page.route('**/functions/v1/bee-chat', async route => {
    const request = route.request().postDataJSON(), command = request.command;
    calls.push(request);
    if (command.kind === 'load' && ++loadCount === 1) {
      await new Promise(resolve => { releaseInitialLoad = resolve; initialLoad.signal(); });
      return fulfill(route, { ok: false, error: 'provider_unavailable' });
    }
    if (command.kind === 'message') return fulfill(route, { ok: false, error: 'upgrade_required' });
    if (command.kind === 'clear_chat' || command.kind === 'new_thread') {
      await new Promise(resolve => { releaseManagement = resolve; managementStarted.signal(); });
      snapshot.thread.version++;
      if (command.kind === 'new_thread') snapshot.thread.id = '22222222-2222-4222-8222-222222222223';
      snapshot.messages = [];
      snapshot.pending = null;
    }
    return fulfill(route, { ok: true, snapshot });
  });
  const button = name => page.getByRole('button', { name, exact: true });
  const assertManagementDisabled = async label => {
    assert.equal(await button('New conversation').isDisabled(), true, `${label}: new conversation disabled`);
    assert.equal(await button('Clear chat').isDisabled(), true, `${label}: clear chat disabled`);
  };
  try {
    await page.goto(base);
    await button('Open Bee chat').click();
    await initialLoad.wait();
    await assertManagementDisabled('loading without a snapshot');
    releaseInitialLoad();
    await button('Refresh conversation').waitFor();
    await assertManagementDisabled('failed load without a snapshot');
    await button('Refresh conversation').click();
    await button('Add to today').waitFor();
    assert.equal(await button('Add to today').isEnabled(), true);
    const input = page.getByRole('textbox', { name: 'Message to Bee', exact: true });
    const upgradeMessage = page.getByRole('alert');
    for (const [action, confirmation, command, notice] of [
      ['Clear chat', 'Delete this chat', 'clear_chat', 'This conversation was cleared. Your saved preferences and food diary are still available.'],
      ['New conversation', 'Start new', 'new_thread', 'New conversation started. Your saved preferences are still available.'],
    ]) {
      await input.fill('TEST DATA paid request');
      await button('Send to Bee').click();
      await upgradeMessage.filter({ hasText: 'AI food help requires Plus.' }).waitFor();
      assert.equal(await button('Send to Bee').isDisabled(), true, 'failed messages cannot be resent normally');
      if (command === 'clear_chat') assert.equal(await button('Add to today').isDisabled(), true, 'failed turns cannot confirm a food review');
      await page.screenshot({ path: `${output}/${command}-failed-${width}.png`, fullPage: true, animations: 'disabled' });
      assert.equal(await button(action).isEnabled(), true, `${action} remains available after upgrade_required`);
      await button(action).click();
      assert.equal(await button(confirmation).isEnabled(), true, `${confirmation} can recover a failed turn`);
      await page.screenshot({ path: `${output}/${command}-confirmation-${width}.png`, fullPage: true, animations: 'disabled' });
      managementStarted = fixtureEvent(command);
      await button(confirmation).click();
      await managementStarted.wait();
      await assertManagementDisabled('management request in flight');
      assert.equal(await button(confirmation).isDisabled(), true, 'confirmation cannot be submitted twice');
      releaseManagement();
      await page.getByText(notice, { exact: true }).waitFor();
      assert.equal(await upgradeMessage.count(), 0, 'successful management clears the failed turn');
      assert.equal(await input.inputValue(), '');
      assert.equal(await button('Clear chat').isDisabled(), true, 'empty conversations cannot be cleared');
      assert.equal(await button('New conversation').isEnabled(), true);
      assert.equal(await button('Add to today').count(), 0, 'management discards an unconfirmed review');
      await page.screenshot({ path: `${output}/${command}-recovered-${width}.png`, fullPage: true, animations: 'disabled' });
    }
    assert.equal(calls.filter(call => call.command.kind === 'clear_chat').length, 1);
    assert.equal(calls.filter(call => call.command.kind === 'new_thread').length, 1);
    assert.equal(calls.filter(call => call.command.kind === 'confirm').length, 0, 'no food save was sent');
    assert.equal(snapshot.memories.length, 1, 'management retains saved preferences');
    // Reload with label access to verify that an open label flow still blocks management.
    snapshot.entitlement.tier = 'plus';
    await button('Close Bee quick log').click();
    await button('Open Bee chat').click();
    await button('Read a label photo').click();
    await assertManagementDisabled('label flow open');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    assert.deepEqual(errors, []);
    assert.deepEqual(failures, []);
    return { width, basicFailureClearChat: true, basicFailureNewConversation: true, foodSaveStillBlocked: true, loadingAndLabelGuards: true, consoleErrors: 0, failedRequests: 0 };
  } catch (error) {
    await page.screenshot({ path: `${output}/failure-${width}.png`, fullPage: true });
    throw error;
  } finally { await context.close(); }
}

module.exports = { verify };
if (require.main === module) (async () => {
  const local = process.env.UI_BASE_URL ? null : await require('./serve-web-export.cjs').serveExport();
  const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || chromium.executablePath(), headless: true, args: ['--no-sandbox'] });
  const results = [];
  try { for (const width of [375, 768, 1440]) results.push(await verify(browser, process.env.UI_BASE_URL || local.base, width)); }
  finally { await browser.close(); if (local) await new Promise(resolve => local.server.close(resolve)); }
  fs.writeFileSync(`${output}/results.json`, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
})().catch(error => { console.error(error); process.exitCode = 1; });
