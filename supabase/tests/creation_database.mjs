import { randomUUID } from 'node:crypto';
export async function runCreationDatabaseTests({ assert, query, queryAsync, literal: q, json, rpc }) {
  assert.equal(query("select count(*) from information_schema.columns where table_schema='public' and table_name='recipes' and column_name in ('servings','instructions','bee_action_id','bee_provenance');"), '4', 'Recipe creation requires additive usable metadata and private provenance');
  const owner = randomUUID(), stranger = randomUUID();
  query(`insert into auth.users values(${q(owner)}),(${q(stranger)}); insert into public.user_goals(user_id,calorie_target,current_weight,age) values(${q(owner)},2000,72,30);`);
  const sub = { external_id: `creation-fixture-${owner}`, product_id: 'fixture-pro-monthly', tier: 'pro', status: 'active', current_period_start: new Date(Date.now()-86400000).toISOString(), current_period_end: new Date(Date.now()+86400000*29).toISOString(), paid_through: new Date(Date.now()+86400000*29).toISOString(), auto_renew: true, billing_interval: 'monthly' };
  rpc('reconcile_subscription', [q('web'),q(randomUUID()),q(new Date().toISOString()),q(owner),json(sub)]);
  const asUser = (sql, user=owner) => query(`set request.jwt.claim.sub=${q(user)}; ${sql}`, 'authenticated');
  const begin = (command, thread=null, expected=null, user=owner) => {const req=randomUUID(); return {...rpc('bee_begin_turn',[q(user),q(thread),q(req),q(req),expected===null?'null':String(expected),q('Asia/Manila'),json(command)]),request:req,user};};
  const finish = (turn,outcome) => rpc('bee_finish_turn',[q(turn.user),q(turn.thread_id),q(turn.request),q(turn.token),json(outcome)]);
  const thread=begin({kind:'new_thread'}).result.snapshot.thread;
  const snapshot=()=>rpc('bee_snapshot',[q(owner),q(thread.id)]);
  // All numbers below are illustrative TEST DATA, not actual retrieved egg nutrition.
  const basis={grams:100,unit:'g',count:null,milliliters:null,nutrients:{calories:150,protein:12,carbs:2,fat:10}};
  const evidence={identity:'Fixture boiled egg',url:'https://fdc.nal.usda.gov/food-details/123/nutrients',title:'Illustrative TEST DATA',sourceId:'123',retrievedAt:new Date().toISOString(),record:'independent',basis};
  evidence.excerpt=JSON.stringify({identity:evidence.identity,url:evidence.url,sourceId:evidence.sourceId,basis,packageGrams:null,data:{fixture:true}});
  const food={name:evidence.identity,query:{name:'Fixture egg',preparation:'boiled',brand:null,variant:null,packageGrams:null,market:null,portion:{amount:72,unit:'g'}},portion:{amount:72,unit:'g'},grams:72,servingLabel:'72 g',calories:108,protein:8.6,carbs:1.4,fat:7.2,source:'usda',evidence};
  const ingredients=[{name:food.name,brands:'',weight:72,unit:'g',default_unit:'g',nutriments:{'energy-kcal_100g':150,proteins_100g:12,carbohydrates_100g:2,fat_100g:10}}];
  const recipe={kind:'recipe',name:'Fixture egg bowl',servings:2,instructions:['Cut and divide the boiled egg between two bowls.'],foods:[food],ingredients,totals:{calories:108,protein:8.64,carbs:1.44,fat:7.2}};
  const personal={kind:'personal_food',name:food.name,defaultUnit:'g',nutrients:basis.nutrients,food};
  const propose=(creation)=>{const s=snapshot();return finish(begin({kind:'message',text:'Make a TEST DATA recipe or food'},thread.id,s.thread.version),{text:'Review before saving to your library; not logged.',creation_draft:creation,state:{awaiting:'review'},invalidate_pending:true});};
  const review=propose(recipe); assert.equal(review.ok,true);assert.equal(review.snapshot.pending.kind,'recipe');
  assert.equal(query(`select count(*) from public.recipes where user_id=${q(owner)};`),'0');
  assert.equal(query(`select count(*) from public.food_logs where user_id=${q(owner)};`),'0');
  assert.equal(begin({kind:'confirm',actionId:review.snapshot.pending.id,reviewVersion:review.snapshot.pending.review_version},thread.id,review.snapshot.thread.version,stranger).error,'not_found');
  const corrected=propose({...recipe,servings:4});assert.equal(corrected.ok,true);
  assert.equal(query(`select status from public.bee_pending_actions where id=${q(review.snapshot.pending.id)};`),'superseded');
  const old=begin({kind:'confirm',actionId:review.snapshot.pending.id,reviewVersion:review.snapshot.pending.review_version},thread.id,corrected.snapshot.thread.version);
  assert.equal(old.ok?finish(old,{}).error:old.error,'stale_action');
  const active=snapshot();const confirm=begin({kind:'confirm',actionId:active.pending.id,reviewVersion:active.pending.review_version},thread.id,active.thread.version);
  const outcomes=await Promise.all(Array.from({length:4},()=>queryAsync(`select public.bee_finish_turn(${q(owner)},${q(thread.id)},${q(confirm.request)},${q(confirm.token)},'{}');`).then(JSON.parse)));
  assert.ok(outcomes.every(x=>x.ok && x.snapshot.saved_action.kind==='recipe'));assert.deepEqual(finish(confirm,{}),outcomes[0]);
  assert.equal(query(`select count(*) from public.recipes where user_id=${q(owner)};`),'1');
  assert.equal(query(`select servings||':'||jsonb_array_length(instructions)||':'||(bee_provenance#>>'{creation,foods,0,source}') from public.recipes where user_id=${q(owner)};`),'4:1:usda');
  assert.equal(asUser(`select count(*) from public.recipes where user_id=${q(owner)};`,stranger),'0');
  assert.equal(query(`select count(*) from public.food_logs where user_id=${q(owner)};`),'0');
  const foodReview=propose(personal);assert.equal(foodReview.ok,true);
  const foodConfirm=begin({kind:'confirm',actionId:foodReview.snapshot.pending.id,reviewVersion:foodReview.snapshot.pending.review_version},thread.id,foodReview.snapshot.thread.version);
  const saved=finish(foodConfirm,{});assert.equal(saved.snapshot.saved_action.kind,'personal_food');assert.deepEqual(finish(foodConfirm,{}),saved);
  assert.equal(query(`select count(*)||':'||max(calories)||':'||max(default_unit) from public.personal_foods where user_id=${q(owner)};`),'1:150:g');
  assert.equal(asUser(`select count(*) from public.personal_foods where user_id=${q(owner)};`,stranger),'0');
  assert.throws(()=>asUser(`update public.recipes set bee_provenance='{}' where user_id=${q(owner)};`));
  assert.throws(()=>asUser(`insert into public.personal_foods(user_id,name,calories,protein,carbs,fat,default_unit,bee_action_id) values(${q(owner)},'Forged',100,1,2,3,'g',${q(active.pending.id)});`));
  asUser(`update public.recipes set servings=3,instructions='["My edited step"]' where user_id=${q(owner)};`);
  assert.equal(query(`select bee_provenance->>'user_edited' from public.recipes where user_id=${q(owner)};`),'true');
  asUser(`update public.personal_foods set calories=170 where user_id=${q(owner)};`);
  assert.equal(query(`select bee_provenance->>'user_edited' from public.personal_foods where user_id=${q(owner)};`),'true');
  const cancelReview=propose(recipe);const cancel=finish(begin({kind:'cancel',actionId:cancelReview.snapshot.pending.id,reviewVersion:cancelReview.snapshot.pending.review_version},thread.id,cancelReview.snapshot.thread.version),{});assert.equal(cancel.ok,true);
  assert.equal(query(`select count(*) from public.recipes where user_id=${q(owner)};`),'1');
  const expiredReview=propose(recipe);
  query(`update public.bee_pending_actions set expires_at=now()-interval '1 second' where user_id=${q(owner)} and id=${q(expiredReview.snapshot.pending.id)};`);
  const expired=finish(begin({kind:'confirm',actionId:expiredReview.snapshot.pending.id,reviewVersion:expiredReview.snapshot.pending.review_version},thread.id,expiredReview.snapshot.thread.version),{});
  assert.equal(expired.error,'expired');assert.equal(query(`select count(*) from public.recipes where user_id=${q(owner)};`),'1');
  const downgradeReview=propose(personal);
  query(`update public.subscriptions set status='revoked' where user_id=${q(owner)};`);
  const denied=finish(begin({kind:'confirm',actionId:downgradeReview.snapshot.pending.id,reviewVersion:downgradeReview.snapshot.pending.review_version},thread.id,downgradeReview.snapshot.thread.version),{});
  assert.equal(denied.error,'pro_required');assert.equal(query(`select count(*) from public.personal_foods where user_id=${q(owner)};`),'1');
  query(`update public.subscriptions set status='active' where user_id=${q(owner)};`);
  const failReview=propose(recipe);
  query(`create function public.fail_fixture_recipe() returns trigger language plpgsql as $$ begin raise exception 'fixture insert failure'; end $$; create trigger fixture_recipe_failure before insert on public.recipes for each row execute function public.fail_fixture_recipe();`);
  const failedTurn=begin({kind:'confirm',actionId:failReview.snapshot.pending.id,reviewVersion:failReview.snapshot.pending.review_version},thread.id,failReview.snapshot.thread.version);
  const failed=finish(failedTurn,{});assert.equal(failed.error,'save_failed');assert.equal(query(`select status from public.bee_pending_actions where id=${q(failReview.snapshot.pending.id)};`),'pending');
  query('drop trigger fixture_recipe_failure on public.recipes; drop function public.fail_fixture_recipe();');
  // The same request can reacquire its failed lease and recover without duplicates.
  const retried=rpc('bee_begin_turn',[q(owner),q(thread.id),q(failedTurn.request),q(failedTurn.request),String(failReview.snapshot.thread.version),q('Asia/Manila'),json({kind:'confirm',actionId:failReview.snapshot.pending.id,reviewVersion:failReview.snapshot.pending.review_version})]);
  assert.equal(retried.ok,true);assert.equal(finish({...failedTurn,...retried},{}).ok,true);
  assert.equal(query(`select count(*) from public.recipes where user_id=${q(owner)};`),'2');
  for(const bad of [{...recipe,totals:{...recipe.totals,calories:999}}, {...recipe,foods:[{...food,source:'web'}]}, {...recipe,ingredients:[{...ingredients[0],weight:100}]}, {...recipe,servings:0}, {...recipe,kind:null}, {...personal,nutrients:null}, {...personal,food:{...food,grams:null}}]) {
    const isolated=begin({kind:'new_thread'}).result.snapshot.thread;
    assert.throws(()=>finish(begin({kind:'message',text:'Bad TEST DATA'},isolated.id,isolated.version),{creation_draft:bad}),/Invalid library creation/);
  }
  for(const name of ['bee_validate_creation(jsonb)','bee_library_ingredient(jsonb)','protect_bee_library_provenance()']) assert.equal(query(`select has_function_privilege('authenticated',${q('public.'+name)},'execute');`),'f');
  const clear=snapshot();assert.equal(finish(begin({kind:'clear_chat'},thread.id,clear.thread.version),{}).ok,true);
  assert.equal(query(`select count(*) from public.recipes where user_id=${q(owner)};`),'2');
  assert.equal(query(`select count(*) from public.personal_foods where user_id=${q(owner)};`),'1');
  asUser(`insert into public.food_logs(user_id,name,calories,protein,carbs,fat,serving_size,serving_unit) values(${q(owner)},'Recipe fraction TEST DATA',27,2,0,2,'0.25','recipe');`);
  assert.equal(query(`select count(*) from public.food_logs where user_id=${q(owner)} and serving_unit='recipe';`),'1');
  asUser(`delete from public.food_logs where user_id=${q(owner)};`);
  // The legacy personal_foods owner FK has no cascade. Account erasure must
  // explicitly remove its owned library first; do not silently alter that FK.
  query(`delete from public.personal_foods where user_id=${q(owner)}; delete from public.recipes where user_id=${q(owner)}; delete from public.user_goals where user_id=${q(owner)}; delete from auth.users where id=${q(owner)};`);
  for(const table of ['recipes','personal_foods','bee_pending_actions']) assert.equal(query(`select count(*) from public.${table} where user_id=${q(owner)};`),'0');
  process.stdout.write('Bee library creation: independent arithmetic, no diary write, owner/tier policies, correction/cancel, concurrent confirmations, replay, failed insert recovery, protected provenance and retention passed.\n');
}
