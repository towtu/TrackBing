import {randomUUID} from 'node:crypto';
// Real PostgreSQL, isolated synthetic accounts and nutrition TEST DATA only.
export async function runLabelDatabaseTests({assert,query,queryAsync,literal:q,json,rpc}){
 const owner=randomUUID(),other=randomUUID();query(`insert into auth.users values(${q(owner)}),(${q(other)});insert into public.user_goals(user_id,age,calorie_target) values(${q(owner)},30,2000);`);
 const now=Date.now();rpc('reconcile_subscription',[q('web'),q(randomUUID()),q(new Date().toISOString()),q(owner),json({external_id:owner,product_id:'fixture-plus',tier:'plus',status:'active',current_period_start:new Date(now-86400000).toISOString(),current_period_end:new Date(now+86400000*29).toISOString(),paid_through:new Date(now+86400000*29).toISOString(),auto_renew:true,billing_interval:'monthly'})]);
 const id=randomUUID(),token=randomUUID();const reserve=(user=owner)=>rpc('reserve_ai_budget',[q(user),q(id),q('sha256-image-fingerprint'),q(token),q('ai_food_assist'),'6000','4096']);
 assert.equal(reserve().ok,true);assert.equal(reserve().error,'busy');
 const result={ok:true,label:{foodName:'TEST label',basis:'per_100g',servingGrams:null,servingDescription:null,energy:100,energyUnit:'kcal',protein:2,carbs:15,fat:3,warnings:[]}};
 assert.equal(rpc('record_ai_call',[q(owner),q(id),q(token),q(randomUUID()),'10','20']).ok,true);
 assert.equal(rpc('finish_ai_budget',[q(owner),q(id),q(token),'true',json(result)]).ok,true);
 assert.deepEqual(reserve().result,result);assert.equal(reserve(other).error,'upgrade_required');
 assert.throws(()=>query(`set request.jwt.claim.sub=${q(other)};select count(*) from public.ai_budget_requests where user_id=${q(owner)};`,'authenticated'),/permission denied/);
 const newRequest=randomUUID();const t=rpc('bee_begin_turn',[q(owner),'null',q(newRequest),q(newRequest),'null',q('Asia/Manila'),json({kind:'new_thread'})]).result.snapshot.thread;
 const reviewId=randomUUID();const command={kind:'food_assist',text:'Review my label food "TEST label" per 100 g: calories 100, protein 2 g, carbs 15 g, fat 3 g; portion 72 g.'};
 const turn=rpc('bee_begin_turn',[q(owner),q(t.id),q(reviewId),q(reviewId),String(t.version),q('Asia/Manila'),json(command)]);
 const basis={grams:100,unit:'g',count:null,milliliters:null,nutrients:{calories:100,protein:2,carbs:15,fat:3}};
 const evidence={identity:'TEST label',url:'',sourceId:'user_label',title:'Your label values',record:'user_owned',retrievedAt:new Date().toISOString(),basis,excerpt:JSON.stringify({identity:'TEST label',url:'',sourceId:'user_label',basis,packageGrams:null,data:{userText:command.text}})};
 const food={name:'TEST label',source:'user_label',query:{name:'TEST label',preparation:null,brand:null,variant:null,packageGrams:null,market:null,portion:{amount:72,unit:'g'}},portion:{amount:72,unit:'g'},grams:72,servingLabel:'72 g',calories:72,protein:1.4,carbs:10.8,fat:2.2,evidence};
 const reviewed=rpc('bee_finish_turn',[q(owner),q(t.id),q(reviewId),q(turn.token),json({text:'Review first.',draft:food,state:{awaiting:'review',query:food.query}})]).snapshot;
 assert.equal(query(`select count(*) from public.food_logs where user_id=${q(owner)};`),'0');
 const confirmId=randomUUID();const confirm=rpc('bee_begin_turn',[q(owner),q(t.id),q(confirmId),q(confirmId),String(reviewed.thread.version),q('Asia/Manila'),json({kind:'confirm',actionId:reviewed.pending.id,reviewVersion:reviewed.pending.review_version})]);
 const sql=`select public.bee_finish_turn(${q(owner)},${q(t.id)},${q(confirmId)},${q(confirm.token)},'{}');`;
 const outcomes=await Promise.all([queryAsync(sql),queryAsync(sql)]);assert.ok(outcomes.every(x=>JSON.parse(x).ok));assert.equal(query(`select count(*)||':'||max(calories)||':'||max(bee_provenance#>>'{food,source}') from public.food_logs where user_id=${q(owner)};`),'1:72:user_label');
 process.stdout.write('Label extraction budget replay/ownership and reviewed food confirmation passed in PostgreSQL.\n');
}
