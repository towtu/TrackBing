import { randomUUID } from 'node:crypto';
export async function runAdaptiveDatabaseTests({assert,query,queryAsync,literal:q,json,rpc}) {
 const owner=randomUUID(), stranger=randomUUID(); query(`insert into auth.users values(${q(owner)}),(${q(stranger)}); insert into public.user_goals(user_id,calorie_target,current_weight,age,gender,height,activity_level) values(${q(owner)},2000,72.4,30,'male',175,'1.375');`);
 const asUser=(sql,user=owner)=>query(`set request.jwt.claim.sub=${q(user)}; ${sql}`,'authenticated');
 const call=(name,args)=>JSON.parse(asUser(`select public.${name}(${args.join(',')});`));
 const before=query(`select calorie_target||':'||protein_grams||':'||target_weight from public.user_goals where user_id=${q(owner)};`);
 const request=randomUUID(), at=new Date(Date.now()-60000).toISOString();
 const args=[q(request),'160',q('lb'),q(at),q('Asia/Manila'),'null','false'];
 const first=call('save_weight_checkin',args), replay=call('save_weight_checkin',args); assert.equal(first.ok,true);assert.deepEqual(replay,first);assert.equal(query(`select count(*) from public.weight_logs where user_id=${q(owner)} and not is_baseline;`),'2'); // initial explicit Profile measurement plus one manual check-in
 assert.equal(query(`select calorie_target||':'||protein_grams||':'||target_weight from public.user_goals where user_id=${q(owner)};`),before);
 assert.equal(Number(asUser(`select count(*) from public.weight_logs where user_id=${q(owner)};`,stranger)),0);
 assert.equal(call('save_weight_checkin',[q(randomUUID()),'70',q('kg'),q(at),q('Asia/Manila'),q(first.id),'false']).ok,true);
 const cross=JSON.parse(asUser(`select public.save_weight_checkin(${q(randomUUID())},null,null,null,null,${q(first.id)},true);`,stranger));assert.equal(cross.error,'not_found');
 const back=call('save_weight_checkin',[q(randomUUID()),'69',q('kg'),q(new Date(Date.now()-86400000*4).toISOString()),q('Asia/Manila'),'null','false']); assert.equal(back.updates_current_weight,false);
 const latest=Number(query(`select current_weight from public.user_goals where user_id=${q(owner)};`));assert.equal(latest,72.4);
 assert.equal(call('save_weight_checkin',[q(randomUUID()),'5',q('kg'),q(at),q('Asia/Manila'),'null','false']).ok,false);
 assert.equal(query(`select has_function_privilege('authenticated','public.adaptive_write_weight(uuid,numeric,text,timestamptz,text,uuid,boolean,uuid)','execute');`),'f');
 process.stdout.write('Adaptive weight ownership, replay, correction, backdating and target preservation passed.\n');
 const basic=rpc('resolve_entitlement',[q(owner)]);assert.equal(basic.tier,'basic');
 const token=randomUUID(), id=randomUUID();const reserve=(feature='ai_food_assist',requestId=id,user=owner)=>rpc('reserve_ai_budget',[q(user),q(requestId),q(requestId),q(token),q(feature),'1000','1000']);
 assert.equal(reserve().error,'upgrade_required');
 const sub={external_id:'fixture-subscription',product_id:'fixture-plus-monthly',tier:'plus',status:'active',current_period_start:new Date(Date.now()-86400000).toISOString(),current_period_end:new Date(Date.now()+86400000*29).toISOString(),paid_through:new Date(Date.now()+86400000*29).toISOString(),auto_renew:true,billing_interval:'monthly'};
 const event=randomUUID(), eventAt=new Date().toISOString();let paid=rpc('reconcile_subscription',[q('web'),q(event),q(eventAt),q(owner),json(sub)]);assert.equal(paid.entitlement.tier,'plus');assert.equal(rpc('reconcile_subscription',[q('web'),q(event),q(eventAt),q(owner),json(sub)]).duplicate,true);
 assert.equal(reserve('bee_chat').error,'pro_required'); assert.equal(reserve().ok,true);
 rpc('record_ai_call',[q(owner),q(id),q(token),q(id),'800','600']);rpc('record_ai_call',[q(owner),q(id),q(token),q(id),'800','600']);
 assert.equal(rpc('reserve_ai_search_queries',[q(owner),q(id),q(token),q(id),'3']).ok,true); rpc('measure_ai_search_queries',[q(owner),q(id),q(token),q(id),'5']);rpc('measure_ai_search_queries',[q(owner),q(id),q(token),q(id),'5']);
 rpc('finish_ai_budget',[q(owner),q(id),q(token),'true',json({text:'Fixture result'})]);const status=rpc('resolve_entitlement',[q(owner)]);assert.equal(status.used.requests,1);assert.equal(status.used.input_tokens,800);assert.equal(status.used.search,5);assert.equal(status.remaining.output_tokens,49400);
 assert.equal(reserve().replay,true); assert.equal(rpc('reconcile_subscription',[q('web'),q(randomUUID()),q(eventAt),q(stranger),json(sub)]).error,'ownership_conflict');
 assert.equal(Number(asUser('select count(*) from public.subscriptions;',stranger)),0);
 for (const name of ['reconcile_subscription(text,text,timestamp with time zone,uuid,jsonb)','reserve_ai_budget(uuid,uuid,text,uuid,text,integer,integer)']) assert.equal(query(`select has_function_privilege('authenticated',${q('public.'+name)},'execute');`),'f');
 assert.equal(query(`select public.billing_period('2026-01-31T12:00:00Z','2026-03-01T00:00:00Z');`),'2026-02-28 12:00:00+00');
 query(`update public.ai_monthly_usage set requests=59 where user_id=${q(owner)};`);
 const concurrent=await Promise.all(Array.from({length:5},()=>{const r=randomUUID();return queryAsync(`select public.reserve_ai_budget(${q(owner)},${q(r)},${q(r)},${q(randomUUID())},'ai_food_assist',1000,1000);`).then(JSON.parse);}));assert.equal(concurrent.filter(r=>r.ok).length,1);
 process.stdout.write('Billing reconciliation, tiers, period boundaries, actual metering, owner policies and concurrency passed.\n');
 // Exact values below are test data, not a provider response or real user records.
 const actor=randomUUID(); query(`insert into auth.users values(${q(actor)}); insert into public.user_goals(user_id,current_weight,calorie_target,protein_grams,carbs_grams,fat_grams,protein_ratio,carbs_ratio,fat_ratio,age,height,gender,activity_level) values(${q(actor)},72,2000,125,225,67,25,45,30,30,175,'male','1.375');`);
 const paidPro={...sub,external_id:'fixture-pro-subscription',product_id:'fixture-pro-monthly',tier:'pro'};rpc('reconcile_subscription',[q('web'),q(randomUUID()),q(new Date().toISOString()),q(actor),json(paidPro)]);
 const begin=(command,thread=null,expected=null,user=actor)=>{const req=randomUUID();return {...rpc('bee_begin_turn',[q(user),q(thread),q(req),q(req),expected===null?'null':String(expected),q('Asia/Manila'),json(command)]),request:req,user};};
 const finish=(turn,outcome)=>rpc('bee_finish_turn',[q(turn.user),q(turn.thread_id),q(turn.request),q(turn.token),json(outcome)]);
 const thread=begin({kind:'new_thread'}).result.snapshot.thread;
 const day=query(`select (now() at time zone 'Asia/Manila')::date;`);
 const atNow=new Date(Date.now()+1000).toISOString();
 const weight={weightKg:72.4,originalAmount:72.4,unit:'kg',measuredAt:atNow,localDate:day,timeZone:'Asia/Manila',updatesCurrentWeight:true};
 const proposal=finish(begin({kind:'message',text:'My weight today is 72.4 kg'},thread.id,thread.version),{text:'Review this test weight.',weight_draft:weight,state:{awaiting:'review'}});assert.equal(proposal.ok,true);assert.equal(proposal.snapshot.pending.kind,'weight');
 assert.equal(query(`select count(*) from public.weight_logs where user_id=${q(actor)} and bee_action_id is not null;`),'0');
 const other=begin({kind:'confirm',actionId:proposal.snapshot.pending.id,reviewVersion:proposal.snapshot.pending.review_version},proposal.snapshot.thread.id,proposal.snapshot.thread.version,stranger);assert.equal(other.error,'not_found');
 const confirm=begin({kind:'confirm',actionId:proposal.snapshot.pending.id,reviewVersion:proposal.snapshot.pending.review_version},proposal.snapshot.thread.id,proposal.snapshot.thread.version);
 const outcome=await Promise.all(Array.from({length:4},()=>queryAsync(`select public.bee_finish_turn(${q(actor)},${q(confirm.thread_id)},${q(confirm.request)},${q(confirm.token)},'{}');`).then(JSON.parse)));assert.ok(outcome.every(v=>v.ok));assert.ok(outcome.every(v=>v.snapshot.saved_action.kind==='weight'));
 assert.equal(query(`select count(*) from public.weight_logs where user_id=${q(actor)} and bee_action_id is not null;`),'1');assert.equal(Number(query(`select current_weight from public.user_goals where user_id=${q(actor)};`)),72.4);assert.equal(Number(query(`select calorie_target from public.user_goals where user_id=${q(actor)};`)),2000);
 const confirmationReplay=finish(confirm,{});assert.deepEqual(confirmationReplay,outcome[0]);
 const snap=rpc('bee_snapshot',[q(actor),q(thread.id)]);const second=finish(begin({kind:'message',text:'My weight is 73 kg'},thread.id,snap.thread.version),{text:'Review another test weight.',weight_draft:{...weight,weightKg:73,originalAmount:73,measuredAt:new Date(Date.now()+2000).toISOString()},state:{awaiting:'review'}});
 query(`update public.subscriptions set status='revoked' where user_id=${q(actor)};`);
 const deny=finish(begin({kind:'confirm',actionId:second.snapshot.pending.id,reviewVersion:second.snapshot.pending.review_version},thread.id,second.snapshot.thread.version),{});assert.equal(deny.error,'pro_required');assert.equal(query(`select count(*) from public.weight_logs where user_id=${q(actor)} and bee_action_id is not null;`),'1');
 const latestSnapshot=rpc('bee_snapshot',[q(actor),q(thread.id)]);const cancelled=finish(begin({kind:'cancel',actionId:latestSnapshot.pending.id,reviewVersion:latestSnapshot.pending.review_version},thread.id,latestSnapshot.thread.version),{});assert.equal(cancelled.ok,true);
 query(`update public.subscriptions set status='active' where user_id=${q(actor)};`);
 const profile=JSON.parse(query(`select row_to_json(u) from public.user_goals u where user_id=${q(actor)};`));const keys=['calorie_target','protein_grams','carbs_grams','fat_grams','goal_mode','goal_rate','target_weight','maintenance_calories','calculation_method'];const previous=Object.fromEntries(keys.map(k=>[k,profile[k]??null]));const goal={previous,next:{...previous,calorie_target:2300,protein_grams:144,carbs_grams:259,fat_grams:77,goal_mode:'maintenance',goal_rate:0,maintenance_calories:2300,calculation_method:'mifflin_st_jeor'},profileRevision:profile.profile_revision};
 const goalReview=finish(begin({kind:'message',text:'Review my maintenance goal'},thread.id,cancelled.snapshot.thread.version),{text:'Review a test calculated goal.',goal_draft:goal,state:{awaiting:'review'}});assert.equal(goalReview.ok,true);assert.equal(Number(query(`select calorie_target from public.user_goals where user_id=${q(actor)};`)),2000);
 query(`update public.user_goals set target_weight=70 where user_id=${q(actor)};`);const stale=finish(begin({kind:'confirm',actionId:goalReview.snapshot.pending.id,reviewVersion:goalReview.snapshot.pending.review_version},thread.id,goalReview.snapshot.thread.version),{});assert.equal(stale.error,'stale_profile');assert.equal(Number(query(`select calorie_target from public.user_goals where user_id=${q(actor)};`)),2000);
 const current=rpc('bee_snapshot',[q(actor),q(thread.id)]);const beforeInsight=current.thread.version;const cacheTurn=finish(begin({kind:'insight'},thread.id,beforeInsight),{});assert.equal(cacheTurn.snapshot.thread.version,beforeInsight);
 const updatedProfile=JSON.parse(query(`select row_to_json(u) from public.user_goals u where user_id=${q(actor)};`));const revised={...goal,previous:Object.fromEntries(keys.map(k=>[k,updatedProfile[k]??null])),next:{...goal.next,target_weight:70},profileRevision:updatedProfile.profile_revision};
 const freshGoal=finish(begin({kind:'message',text:'Review updated maintenance goal'},thread.id,beforeInsight),{text:'Review the exact test goal.',goal_draft:revised,state:{awaiting:'review'}});assert.equal(freshGoal.ok,true);assert.equal(freshGoal.snapshot.pending.origin_tier,'pro');
 const accepted=finish(begin({kind:'confirm',actionId:freshGoal.snapshot.pending.id,reviewVersion:freshGoal.snapshot.pending.review_version},thread.id,freshGoal.snapshot.thread.version),{});assert.equal(accepted.ok,true);assert.equal(accepted.snapshot.saved_action.kind,'goal');assert.equal(Number(query(`select calorie_target from public.user_goals where user_id=${q(actor)};`)),2300);assert.equal(Number(query(`select current_weight from public.user_goals where user_id=${q(actor)};`)),72.4);
 assert.throws(()=>asUser(`insert into public.food_logs(user_id,name,calories,protein,carbs,fat,serving_size,serving_unit,bee_action_id) values(${q(actor)},'Forged test review',100,1,2,3,'1','g',${q(freshGoal.snapshot.pending.id)});`,actor));
 assert.equal(query(`select has_function_privilege('authenticated','public.protect_bee_food_provenance()','execute');`),'f');
 // The following nutrition is illustrative TEST DATA, not retrieved production evidence.
 const food={name:'Fixture boiled egg',query:{name:'Fixture egg',preparation:'boiled',brand:null,variant:null,packageGrams:null,market:null,portion:{amount:72,unit:'g'}},portion:{amount:72,unit:'g'},grams:72,servingLabel:'72 g',calories:72,protein:4.32,carbs:7.2,fat:2.88,source:'usda',evidence:{url:'https://fdc.nal.usda.gov/food-details/1/nutrients',title:'TEST DATA source',identity:'Fixture boiled egg',retrievedAt:new Date().toISOString(),excerpt:'TEST DATA, not live retrieved nutrition',record:'independent',basis:{grams:100,count:null,milliliters:null,unit:'g',nutrients:{calories:100,protein:6,carbs:10,fat:4}}}};
 const ownedSnapshot=rpc('bee_snapshot',[q(actor),q(thread.id)]);const foodReview=finish(begin({kind:'message',text:'Review 72 g fixture egg'},thread.id,ownedSnapshot.thread.version),{text:'Review fixture food.',draft:food,state:{awaiting:'review'}});assert.equal(foodReview.ok,true);assert.equal(foodReview.snapshot.pending.origin_tier,'pro');
 const foodConfirm=begin({kind:'confirm',actionId:foodReview.snapshot.pending.id,reviewVersion:foodReview.snapshot.pending.review_version},thread.id,foodReview.snapshot.thread.version);
 const foodOutcomes=await Promise.all(Array.from({length:4},()=>queryAsync(`select public.bee_finish_turn(${q(actor)},${q(foodConfirm.thread_id)},${q(foodConfirm.request)},${q(foodConfirm.token)},'{}');`).then(JSON.parse)));assert.ok(foodOutcomes.every(v=>v.ok));assert.equal(query(`select count(*) from public.food_logs where user_id=${q(actor)} and bee_action_id=${q(foodReview.snapshot.pending.id)};`),'1');assert.deepEqual(finish(foodConfirm,{}),foodOutcomes[0]);
 assert.throws(()=>asUser(`update public.food_logs set bee_provenance='{}' where user_id=${q(actor)};`,actor));
 asUser(`update public.food_logs set name='User edited fixture egg' where user_id=${q(actor)};`,actor);assert.equal(query(`select bee_provenance->>'user_edited' from public.food_logs where user_id=${q(actor)};`),'true');
 process.stdout.write('Current tier-bound food confirmation, response-loss recovery and protected provenance passed.\n');
 assert.equal(rpc('reserve_ai_lookup',[q(actor),q(randomUUID()),q('fixture'),q(randomUUID())]).ok,false);
 for(const table of ['billing_provider_bindings','billing_purchase_credentials','billing_requests'])assert.equal(query(`select has_table_privilege('authenticated','public.${table}','SELECT,INSERT,UPDATE,DELETE');`),'f');
 const br=randomUUID(),bt=randomUUID();const started=rpc('begin_billing_request',[q(actor),q(br),q('checkout-fixture'),q(bt)]);assert.equal(started.ok,true);assert.equal(rpc('begin_billing_request',[q(actor),q(br),q('changed'),q(bt)]).error,'conflict');assert.equal(rpc('begin_billing_request',[q(actor),q(br),q('checkout-fixture'),q(bt)]).error,'busy');assert.equal(query(`select public.finish_billing_request(${q(actor)},${q(br)},${q(bt)},${json({ok:true,fixture:true})});`),'t');assert.equal(rpc('begin_billing_request',[q(actor),q(br),q('checkout-fixture'),q(bt)]).replay,true);
 process.stdout.write('Atomic Bee weight confirmations, cross-owner denial, replay, downgrade, cancel, stale goal review and billing request fencing passed.\n');

 // Illustrative diary TEST DATA at the edges of a 25-hour DST local day.
 const dstOwner=randomUUID();query(`insert into auth.users values(${q(dstOwner)}); insert into public.food_logs(user_id,name,calories,protein,carbs,fat,serving_size,serving_unit,created_at) values(${q(dstOwner)},'DST fixture',10,1,1,1,'1','g','2026-11-02T04:59:59Z'),(${q(dstOwner)},'Next day fixture',20,1,1,1,'1','g','2026-11-02T05:00:00Z'),(${q(owner)},'Another owner fixture',30,1,1,1,'1','g','2026-11-02T04:00:00Z');`);
 const dst=JSON.parse(asUser(`select public.get_weekly_stats('2026-11-01T04:00:00Z','2026-11-02T05:00:00Z');`,dstOwner));assert.equal(dst.today.count,1);assert.equal(dst.today.calories,10);
 const nextDay=JSON.parse(asUser(`select public.get_weekly_stats('2026-11-02T05:00:00Z','2026-11-03T05:00:00Z');`,dstOwner));assert.equal(nextDay.today.count,1);assert.equal(nextDay.today.calories,20);
 assert.throws(()=>asUser(`select public.get_weekly_stats('2026-11-02T05:00:00Z','2026-11-01T05:00:00Z');`,dstOwner));assert.equal(query(`select has_function_privilege('anon','public.get_weekly_stats(timestamptz,timestamptz)','execute');`),'f');
 process.stdout.write('Owner-scoped weekly stats use explicit local boundaries across DST and exclude the next day.\n');

 // Operator account erasure must not recreate context rows during FK cascades.
 // All records below belong to disposable TEST DATA owners in this database.
 const removed=randomUUID();
 query(`insert into auth.users values(${q(removed)}); insert into public.user_goals(user_id,calorie_target,current_weight) values(${q(removed)},2000,72); insert into public.bee_memories(user_id,key,value) values(${q(removed)},'preferred_units','grams'); delete from public.user_goals where user_id=${q(removed)};`);
 assert.equal(Number(query(`select count(*) from public.weight_logs where user_id=${q(removed)};`)),1);
 query(`delete from auth.users where id=${q(removed)};`);
 for(const table of ['weight_logs','bee_memories','bee_context_revisions']) assert.equal(query(`select count(*) from public.${table} where user_id=${q(removed)};`),'0');
 assert.equal(query(`select has_function_privilege('authenticated','public.adaptive_bump_context()','execute');`),'f');
 process.stdout.write('Auth account cascades remove private context and weight rows without recreating deleted owners.\n');

}
