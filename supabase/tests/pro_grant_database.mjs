import { randomUUID } from 'node:crypto';

// Synthetic accounts/subscriptions in disposable PostgreSQL only; never paid receipts.
export async function runProGrantDatabaseTests({ assert, query, queryAsync, literal: q, json, rpc }) {
  assert.equal(query("select to_regclass('public.pro_access_grants') is not null;"), 't',
    'complimentary Pro must have separate, server-owned records');
  // The small auth fixture otherwise needs only an ID. Supabase owns this column in production.
  query('alter table auth.users add column if not exists email_confirmed_at timestamptz;');
  const owner = randomUUID(), other = randomUUID(), unverified = randomUUID(), minor = randomUUID();
  query(`insert into auth.users(id,email_confirmed_at) values
    (${q(owner)},now()),(${q(other)},now()),(${q(unverified)},null),(${q(minor)},now());
    insert into public.user_goals(user_id,age,calorie_target) values
    (${q(owner)},30,2000),(${q(other)},30,2000),(${q(unverified)},30,2000),(${q(minor)},17,2000);`);
  const until = new Date(Date.now() + 30 * 86400000).toISOString();
  const grant = (id = owner, end = until, reason = 'TEST operator grant') =>
    rpc('grant_complimentary_pro', [q(id), q(end), q(reason)]);
  const entitlement = (id = owner) => rpc('resolve_entitlement', [q(id)]);
  for (const role of ['anon', 'authenticated']) {
    assert.throws(() => query(`select public.grant_complimentary_pro(${q(owner)},${q(until)},'TEST');`, role), /permission denied/);
    assert.throws(() => query(`select public.revoke_complimentary_pro(${q(owner)});`, role), /permission denied/);
    assert.throws(() => query(`insert into public.pro_access_grants(user_id,reason) values(${q(owner)},'TEST');`, role), /permission denied/);
  }
  assert.throws(() => query(`insert into public.pro_access_grants(user_id,reason) values(${q(owner)},'TEST');`, 'service_role'), /permission denied/);
  for (const id of [unverified, minor, randomUUID()]) assert.throws(() => grant(id), /verified adult account required/);
  for (const invalid of ['', ' '.repeat(4), 'x'.repeat(201), null]) assert.throws(() => grant(owner, until, invalid), /invalid grant/);
  for (const invalid of ['infinity', '-infinity', new Date(Date.now() - 1000).toISOString()]) assert.throws(() => grant(owner, invalid), /invalid grant/);
  assert.equal(entitlement().tier, 'basic');
  const initialPayments = query('select count(*) from public.subscriptions;');
  const initialEvents = query('select count(*) from public.subscription_events;');

  // Upgrade a preview with an in-flight request; keep its exact period/usage/reservation.
  query(`insert into public.bee_preview_access(user_id) values(${q(owner)});`, 'service_role');
  const previewPeriod = entitlement().period, request = randomUUID(), token = randomUUID();
  assert.equal(rpc('reserve_ai_budget', [q(owner),q(request),q('TEST preview'),q(token),q('bee_chat'),'1000','1000']).ok, true);
  assert.equal(rpc('record_ai_call', [q(owner),q(request),q(token),q(randomUUID()),'10','20']).ok, true);
  // A conflicting pre-existing billing period must fail closed, not reset trial usage.
  query(`insert into public.billing_accounts(user_id,anchor) values(${q(owner)},${q(previewPeriod)}::timestamptz-interval '1 day');`);
  assert.throws(() => grant(), /preview usage period mismatch/);
  assert.equal(entitlement().access_mode, 'private_preview');
  query(`delete from public.billing_accounts where user_id=${q(owner)};`);
  let e = grant();
  assert.equal(e.tier, 'pro'); assert.equal(e.access_mode, 'complimentary');
  assert.equal(e.period, previewPeriod); assert.equal(new Date(e.access_expires_at).toISOString(), until);
  assert.deepEqual(e.limits, { requests:250, search:50, insights:30, input_tokens:800000, output_tokens:200000 });
  for (const name of ['bee_chat','web_food_search','read_nutrition_label','food_suggestions']) assert.equal(e.capabilities[name], true);
  assert.equal(e.remaining.requests, 249); assert.equal(e.used.input_tokens, 10);
  assert.equal(e.remaining.output_tokens, 200000 - 20 - 1000);
  assert.equal(rpc('finish_ai_budget', [q(owner),q(request),q(token),'true',json({ok:true})]).ok, true);
  const anchor = query(`select anchor from public.billing_accounts where user_id=${q(owner)};`);
  const before = JSON.stringify(entitlement().used);
  grant();
  const longer = new Date(Date.now() + 60 * 86400000).toISOString();
  grant(owner, longer); grant(owner, until);
  assert.equal(new Date(entitlement().access_expires_at).toISOString(), longer, 'retry cannot shorten a valid grant');
  assert.equal(query(`select anchor from public.billing_accounts where user_id=${q(owner)};`), anchor);
  assert.equal(JSON.stringify(entitlement().used), before);
  assert.equal(query(`select count(*) from public.pro_access_grants where user_id=${q(owner)};`), '1');
  assert.equal(query(`set request.jwt.claim.sub=${q(other)};select count(*) from public.pro_access_grants;`, 'authenticated'), '0');
  assert.equal(query(`set request.jwt.claim.sub=${q(owner)};select count(*) from public.pro_access_grants;`, 'authenticated'), '1');
  assert.throws(() => query(`update public.pro_access_grants set expires_at=null where user_id=${q(owner)};`, 'authenticated'), /permission denied/);
  assert.equal(query(`set request.jwt.claim.sub=${q(owner)};select public.account_entitlement()->>'access_mode';`, 'authenticated'), 'complimentary');
  assert.equal(query('select count(*) from public.subscriptions;'), initialPayments);
  assert.equal(query('select count(*) from public.subscription_events;'), initialEvents);

  // Existing paid billing anchors/usage survive an upgrade; paid Pro wins over a grant.
  const now = Date.now(), start = new Date(now - 86400000).toISOString();
  const paid = (tier) => rpc('reconcile_subscription', [q('web'),q(randomUUID()),q(new Date().toISOString()),q(other),json({
    external_id:`TEST-grant-${other}-${tier}`,product_id:`TEST-${tier}`,tier,status:'active',
    current_period_start:start,current_period_end:until,paid_through:until,auto_renew:true,billing_interval:'monthly',
  })]);
  assert.equal(paid('plus').ok, true);
  const paidPeriod = entitlement(other).period;
  query(`insert into public.ai_monthly_usage(user_id,period,requests) values(${q(other)},${q(paidPeriod)},5);`);
  e = grant(other); assert.equal(e.access_mode, 'complimentary'); assert.equal(e.period, paidPeriod); assert.equal(e.remaining.requests,245);
  assert.equal(paid('pro').ok, true);
  assert.equal(entitlement(other).access_mode, 'subscription');
  assert.equal(rpc('revoke_complimentary_pro', [q(other)]).tier, 'pro', 'revoking a gift cannot revoke a paid subscription');
  query(`update public.subscriptions set status='revoked' where user_id=${q(other)} and tier='pro';`);
  assert.equal(entitlement(other).tier, 'plus');

  // Expiry/revoke restores the actual previous entitlement, without erasing usage.
  query(`update public.pro_access_grants set expires_at=clock_timestamp()-interval '1 second',starts_at=clock_timestamp()-interval '1 day' where user_id=${q(owner)};`);
  assert.equal(entitlement().access_mode, 'private_preview');
  grant(owner, null); assert.equal(entitlement().access_expires_at, null);
  assert.equal(entitlement().access_mode, 'complimentary');
  grant(); assert.equal(entitlement().access_expires_at, null, 'bounded retry cannot shorten ongoing access');
  assert.equal(rpc('revoke_complimentary_pro', [q(owner)]).access_mode, 'private_preview');
  query(`delete from public.bee_preview_access where user_id=${q(owner)};`, 'service_role');
  assert.equal(entitlement().tier, 'basic');
  assert.equal(rpc('revoke_complimentary_pro', [q(owner)]).tier, 'basic');
  assert.equal(JSON.stringify(entitlement().used), before);

  // Concurrent grants and last-slot reservations keep one fixed owner billing period.
  await Promise.all(Array.from({ length:3 }, () => queryAsync(`select public.grant_complimentary_pro(${q(owner)},${q(until)},'TEST concurrent');`)));
  assert.equal(query(`select anchor from public.billing_accounts where user_id=${q(owner)};`), anchor);
  query(`update public.ai_monthly_usage set requests=249 where user_id=${q(owner)} and period=${q(previewPeriod)};`);
  const outcomes = await Promise.all(Array.from({ length:4 }, () => queryAsync(`select public.reserve_ai_budget(${q(owner)},${q(randomUUID())},'TEST final slot',${q(randomUUID())},'bee_chat',1000,1000);`).then(JSON.parse)));
  assert.equal(outcomes.filter(x => x.ok).length, 1);
  assert.equal(entitlement().remaining.requests, 0);

  // Direct service writes still cannot violate date constraints.
  assert.throws(() => query(`update public.pro_access_grants set expires_at=starts_at where user_id=${q(owner)};`), /check constraint/);
  assert.throws(() => query(`update public.pro_access_grants set starts_at='infinity' where user_id=${q(owner)};`), /check constraint/);
  process.stdout.write('Complimentary Pro ownership, no-payment grants, expiry/revoke, paid precedence, preserved usage and concurrent caps passed.\n');
}
