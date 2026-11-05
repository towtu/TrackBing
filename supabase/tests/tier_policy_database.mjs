import {randomUUID} from 'node:crypto';
// Subscription fixtures are test data in disposable PostgreSQL only.
export async function runTierPolicyDatabaseTests({assert,query,queryAsync,literal:q,json,rpc}) {
 const plus=randomUUID(),pro=randomUUID(),basic=randomUUID();
 query(`insert into auth.users values(${q(plus)}),(${q(pro)}),(${q(basic)});`);
 const now=Date.now();
 for(const [user,tier] of [[plus,'plus'],[pro,'pro']]) {
  const s={external_id:`TEST-policy-${user}`,product_id:`TEST-${tier}`,tier,status:'active',current_period_start:new Date(now-86400000).toISOString(),current_period_end:new Date(now+86400000*29).toISOString(),paid_through:new Date(now+86400000*29).toISOString(),auto_renew:true,billing_interval:'monthly'};
  assert.equal(rpc('reconcile_subscription',[q('web'),q(randomUUID()),q(new Date(now).toISOString()),q(user),json(s)]).ok,true);
 }
 const e=rpc('resolve_entitlement',[q(plus)]);
 assert.equal(e.limits.requests,60);assert.equal(e.limits.search,0);
 assert.equal(e.capabilities.google_food_search,false);assert.equal(e.capabilities.web_food_search,false);
 assert.equal(e.capabilities.read_nutrition_label,true);assert.equal(e.capabilities.food_suggestions,true);assert.equal(e.capabilities.bee_chat,false);
 const pe=rpc('resolve_entitlement',[q(pro)]);
 assert.equal(pe.limits.requests,250);assert.equal(pe.limits.search,50);
 for(const c of ['google_food_search','web_food_search','read_nutrition_label','food_suggestions','bee_chat'])assert.equal(pe.capabilities[c],true);
 const be=rpc('resolve_entitlement',[q(basic)]);
 for(const c of ['web_food_search','read_nutrition_label','food_suggestions'])assert.equal(be.capabilities[c],false);
 const request=randomUUID(),token=randomUUID();
 assert.equal(rpc('reserve_ai_budget',[q(plus),q(request),q('TEST-Plus-food'),q(token),q('ai_food_assist'),'1000','1000']).ok,true);
 assert.equal(rpc('reserve_ai_search_queries',[q(plus),q(request),q(token),q(randomUUID()),'1']).error,'pro_required');
 assert.equal(query(`select count(*) from public.ai_search_calls where user_id=${q(plus)};`),'0');
 assert.equal(query(`select search_queries from public.ai_monthly_usage where user_id=${q(plus)};`),'0');
 const pr=randomUUID(),pt=randomUUID();
 assert.equal(rpc('reserve_ai_budget',[q(pro),q(pr),q('TEST-Pro-food'),q(pt),q('ai_food_assist'),'1000','1000']).ok,true);
 query(`update public.ai_monthly_usage set search_queries=49 where user_id=${q(pro)};`);
 const searches=await Promise.all(Array.from({length:3},()=>queryAsync(`select public.reserve_ai_search_queries(${q(pro)},${q(pr)},${q(pt)},${q(randomUUID())},1);`).then(JSON.parse)));
 assert.equal(searches.filter(x=>x.ok).length,1);
 assert.equal(query(`select search_queries from public.ai_monthly_usage where user_id=${q(pro)};`),'50');
 assert.equal(query(`select has_function_privilege('authenticated','public.reserve_ai_search_queries(uuid,uuid,uuid,uuid,integer)','execute');`),'f');
 query(`set request.jwt.claim.sub=${q(plus)};`, 'authenticated');
 assert.throws(()=>query(`select public.resolve_entitlement(${q(pro)});`,'authenticated'),/permission denied/);
 process.stdout.write('Plus label/suggestion access and Pro-only concurrent Search policy passed.\n');
}
