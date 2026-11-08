import { randomUUID } from "node:crypto";

// Invalid legacy rows are seeded before the new migration. No production data
// or credentials are used; PostgreSQL enforces actual roles and constraints.
export function seedLaunchLegacyRows({ query, literal: q }) {
  const owner = randomUUID();
  query(`insert into auth.users(id) values(${q(owner)});
    insert into public.food_logs(user_id,name,calories,protein,carbs,fat,serving_size,serving_unit) values(${q(owner)},' ', -1,'NaN',0,0,'one bowl','unknown');
    insert into public.personal_foods(user_id,name,calories,protein,carbs,fat,default_unit) values(${q(owner)},' ',0,-1,0,0,'unknown');
    insert into public.user_goals(user_id,calorie_target,current_weight,height,age,protein_ratio) values(${q(owner)},-1,0,-1,3,200);
    insert into public.daily_summaries(user_id,date,calories,meal_count) values(${q(owner)},current_date,-1,-1);
    insert into public.recipes(user_id,name,ingredients) values(${q(owner)},' ', '{"legacy":"unstructured"}');`);
  const tables = ["food_logs", "personal_foods", "user_goals", "daily_summaries", "recipes"];
  const read = table => query(`select jsonb_agg(to_jsonb(t) order by id) from public.${table} t where user_id=${q(owner)};`);
  return { owner, rows: Object.fromEntries(tables.map(table => [table, read(table)])) };
}

export async function runLaunchDatabaseTests({ assert, query, queryAsync, literal: q, json, rpcSql, rpc, legacy }) {
  const user = () => { const id=randomUUID(); query(`insert into auth.users(id) values(${q(id)});`); return id; };
  const owner=user(), stranger=user();
  const asUser=(sql,id=owner)=>query(`set request.jwt.claim.sub=${q(id)};\n${sql}`,"authenticated");
  const ingredient={name:"Fixture ingredient",brands:"Fixture",weight:50,unit:"g",default_unit:"g",nutriments:{"energy-kcal_100g":100,proteins_100g:5,carbohydrates_100g:10,fat_100g:3}};
  const test=async(name,run)=>{ await run(); process.stdout.write(`  ✓ ${name}\n`); };
  const foodInsert=(table,patch={})=>{
    const row={user_id:owner,name:"Valid fixture food",calories:100,protein:5,carbs:10,fat:3,...patch};
    const columns=Object.keys(row);
    const values=columns.map(key=>typeof row[key]==="number"?String(row[key]):q(row[key]));
    return `insert into public.${table}(${columns.join(",")}) values(${values.join(",")});`;
  };

  await test("new database validation rejects nonfinite/negative macros, blank names, invalid servings, units and barcodes",()=>{
    for(const table of ["food_logs","personal_foods"]){
      asUser(foodInsert(table));
      for(const patch of [{name:"   "},{name:"x".repeat(301)},{calories:-1},{protein:"NaN"},{carbs:"Infinity"},{fat:"-Infinity"},{fat:100001},{barcode:"12AB"}])
        assert.throws(()=>asUser(foodInsert(table,patch)),/check constraint|Invalid/);
    }
    for(const serving_size of ["", "0", "-1", "NaN", "Infinity", "1 bowl", "100001"])
      assert.throws(()=>asUser(foodInsert("food_logs",{serving_size,serving_unit:"g"})),/check constraint|Invalid/);
    assert.throws(()=>asUser(foodInsert("food_logs",{serving_size:"1",serving_unit:"unknown"})),/check constraint|Invalid/);
    assert.throws(()=>asUser(foodInsert("food_logs",{serving_size:"1",serving_unit:null})),/check constraint|Invalid/);
    assert.throws(()=>asUser(foodInsert("personal_foods",{default_unit:"unknown"})),/check constraint|Invalid/);
    asUser(foodInsert("food_logs",{serving_size:"0.5",serving_unit:"serving",calories:0,protein:0,carbs:0,fat:0,barcode:"1234"}));
    asUser(foodInsert("personal_foods",{default_unit:"oz",barcode:"12345678"}));
  });

  await test("goal and summary guards preserve custom targets while rejecting invalid stats and totals",()=>{
    const goal={user_id:owner,calorie_target:900,current_weight:60,target_weight:60,height:170,age:20,gender:"female",activity_level:"1.375",protein_ratio:25,carbs_ratio:45,fat_ratio:30,goal_mode:"custom_calories",unit_system:"metric"};
    const insert=patch=>{const row={...goal,...patch};return `insert into public.user_goals(${Object.keys(row).join(",")}) values(${Object.values(row).map(v=>typeof v==="number"?String(v):q(v)).join(",")});`;};
    for(const patch of [{calorie_target:0},{current_weight:"NaN"},{current_weight:301},{height:99},{age:12},{age:101},{gender:"unknown"},{activity_level:"99"},{protein_ratio:101},{carbs_ratio:40},{protein_grams:-1},{goal_mode:"injected"},{goal_rate:"Infinity"},{unit_system:"unknown"}])
      assert.throws(()=>asUser(insert(patch)),/check constraint|Invalid/);
    asUser(insert({}));
    assert.equal(asUser(`select calorie_target from public.user_goals where user_id=${q(owner)};`),"900");
    assert.throws(()=>asUser(`update public.user_goals set target_weight=0 where user_id=${q(owner)};`),/check constraint|Invalid/);
    for(const column of ["calories","protein","carbs","fat","meal_count"])
      assert.throws(()=>asUser(`insert into public.daily_summaries(user_id,date,${column}) values(${q(owner)},current_date,-1);`),/check constraint|Invalid/);
    assert.equal(JSON.parse(asUser("select public.refresh_daily_summary(current_date,'UTC');")).ok,true);
  });

  await test("recipes isolate owners even alongside permissive policies and reject arbitrary private references",()=>{
    // Restrictive ownership must remain effective when a future policy is permissive.
    query("create policy test_permissive_recipe on public.recipes for all to authenticated using(true) with check(true);");
    const id=randomUUID();
    asUser(`insert into public.recipes(id,user_id,name,ingredients) values(${q(id)},${q(owner)},'Fixture recipe',${json([ingredient])});`);
    assert.equal(asUser(`select count(*) from public.recipes where id=${q(id)};`,stranger),"0");
    assert.equal(asUser(`with changed as(update public.recipes set name='Not mine' where id=${q(id)} returning id) select count(*) from changed;`,stranger),"0");
    assert.throws(()=>asUser(`insert into public.recipes(user_id,name,ingredients) values(${q(stranger)},'Cross owner',${json([ingredient])});`),/row-level security/);
    assert.throws(()=>asUser(`update public.recipes set user_id=${q(stranger)} where id=${q(id)};`),/row-level security/);
    for(const ingredients of [[],{},[ingredient,{...ingredient,weight:0}],[{...ingredient,food_id:randomUUID()}],[{...ingredient,user_id:stranger}],[{...ingredient,nutriments:{...ingredient.nutriments,fat_100g:null}}],[{...ingredient,nutriments:{...ingredient.nutriments,fat_100g:-1}}],Array.from({length:101},()=>ingredient)])
      assert.throws(()=>asUser(`update public.recipes set ingredients=${json(ingredients)} where id=${q(id)};`),/check constraint|Invalid recipe/);
    asUser(`update public.recipes set name='Updated own recipe' where id=${q(id)};`);
    query("drop policy test_permissive_recipe on public.recipes;");
    assert.equal(query("select to_regclass('public.recipe_items') is null;"),"t");
  });

  await test("client grants cannot truncate owned tables, access accounting tables or invoke privileged RPCs",()=>{
    for(const table of ["food_logs","personal_foods","user_goals","daily_summaries","recipes"]){
      assert.equal(query(`select has_table_privilege('authenticated','public.${table}','TRUNCATE,TRIGGER,REFERENCES');`),"f");
      assert.equal(query(`select has_table_privilege('anon','public.${table}','SELECT,INSERT,UPDATE,DELETE');`),"f");
      assert.throws(()=>query(`truncate public.${table};`,"authenticated"),/permission denied/);
    }
    for(const table of ["ai_usage","entitlements"]){
      assert.equal(query(`select has_table_privilege('authenticated','public.${table}','INSERT,UPDATE,DELETE,TRUNCATE');`),"f");
      assert.equal(query(`select has_table_privilege('authenticated','public.${table}','SELECT');`),"t");
    }
    for(const role of ["anon","authenticated"]){
      assert.equal(query(`select has_function_privilege('${role}','public.reserve_usda_request(uuid)','EXECUTE');`),"f");
      assert.equal(query(`select has_function_privilege('${role}','public.increment_ai_usage(uuid,text)','EXECUTE');`),"f");
    }
    assert.equal(query("select has_function_privilege('anon','public.get_weekly_stats(timestamptz)','EXECUTE');"),"f");
    assert.throws(()=>asUser(`select public.reserve_usda_request(${q(owner)});`),/permission denied/);
    assert.equal(asUser(`select public.get_weekly_stats(now())->>'calorie_target';`),"900");
    assert.equal(asUser(`select public.get_weekly_stats(now())->>'calorie_target';`,stranger),"");
  });

  await test("simultaneous USDA requests obey thirty per owner per minute without paid AI usage",async()=>{
    const who=user();
    // Avoid allowing this concurrency fixture to straddle a real UTC boundary.
    const seconds=Number(query("select extract(second from clock_timestamp());"));
    if(seconds>50) await new Promise(resolve=>setTimeout(resolve,Math.ceil((61-seconds)*1000)));
    const minute=query("select date_trunc('minute',now() at time zone 'UTC') at time zone 'UTC';");
    query(`insert into public.usda_request_limits(user_id,minute_period,count) values(${q(who)},${q(minute)},29);`);
    const results=await Promise.all(Array.from({length:8},()=>queryAsync(rpcSql("reserve_usda_request",[q(who)])).then(JSON.parse)));
    assert.equal(results.filter(r=>r.ok).length,1);
    assert.ok(results.filter(r=>!r.ok).every(r=>r.error==="rate_limited" && r.retry_after>=1 && r.retry_after<=60));
    assert.equal(query(`select count from public.usda_request_limits where user_id=${q(who)};`),"30");
    assert.equal(query(`select count(*) from public.ai_usage where user_id=${q(who)};`),"0");
    const independent=user(); assert.equal(rpc("reserve_usda_request",[q(independent)]).ok,true);
    query(`update public.usda_request_limits set minute_period=minute_period-interval '1 minute' where user_id=${q(who)};`);
    assert.equal(rpc("reserve_usda_request",[q(who)]).remaining,29);
    assert.equal(query(`select count from public.usda_request_limits where user_id=${q(who)};`),"1");
    query(`update public.usda_request_limits set minute_period=minute_period+interval '1 minute',count=30 where user_id=${q(who)};`);
    assert.equal(rpc("reserve_usda_request",[q(who)]).error,"rate_limited","delayed requests cannot rewind a newer bucket");
    assert.equal(query(`select count from public.usda_request_limits where user_id=${q(who)};`),"30");
    assert.equal(query("select relrowsecurity from pg_class where oid='public.usda_request_limits'::regclass;"),"t");
    assert.equal(query("select has_table_privilege('authenticated','public.usda_request_limits','SELECT,INSERT,UPDATE,DELETE');"),"f");
  });

  await test("the additive migration leaves all invalid legacy rows untouched",()=>{
    for(const [table,before] of Object.entries(legacy.rows))
      assert.equal(query(`select jsonb_agg(to_jsonb(t) order by id) from public.${table} t where user_id=${q(legacy.owner)};`),before);
    assert.equal(query("select count(*) from pg_constraint where conname like 'launch_%' and convalidated;"),"0");
  });
}
