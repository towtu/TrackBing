import { randomUUID } from "node:crypto";

export async function runBeeMigrationDatabaseTests({ assert, query, queryAsync, literal: q, json, rpcSql, rpc }) {
  const user = () => { const id = randomUUID(); query(`insert into auth.users(id) values(${q(id)});`); return id; };
  const owner = user();
  const stranger = user();
  const beginArgs = (owner, thread, request, command) => [q(owner),q(thread?.id ?? null),q(request),q(request),thread ? String(thread.version) : "null","'Asia/Manila'",json(command)];
  const begin = (owner, thread, command, request = randomUUID()) => ({ ...rpc("bee_begin_turn",beginArgs(owner,thread,request,command)),owner,request });
  const finish = (turn,outcome) => rpc("bee_finish_turn",[q(turn.owner),q(turn.thread_id),q(turn.request),q(turn.token),json(outcome)]);
  const create = (owner) => begin(owner,null,{kind:"new_thread"}).result.snapshot.thread;
  const snapshot = (owner,thread) => rpc("bee_snapshot",[q(owner),q(thread.id)]);
  const food = { name:"Independent boiled egg",query:{name:"egg",preparation:"boiled",portion:{amount:72,unit:"g"}},portion:{amount:72,unit:"g"},grams:72,servingLabel:"72 g",calories:111.6,protein:9.36,carbs:0.72,fat:7.92,source:"usda",evidence:{record:"independent",title:"USDA record",url:"https://fdc.nal.usda.gov/food-details/fixture",retrievedAt:"2026-09-26T00:00:00Z",basis:{grams:100,nutrients:{calories:155,protein:13,carbs:1,fat:11}}} };
  const errors = [];
  const test = async(name,run) => { try { await run(); process.stdout.write(`  ✓ ${name}\n`); } catch(error) { errors.push(new Error(name,{cause:error})); process.stdout.write(`  ✗ ${name}: ${error.message}\n`); } };

  await test("Google-grounded and unclassified evidence cannot become a reviewed draft",() => {
    for (const draft of [{...food,source:"google_grounded"},{...food,evidence:{...food.evidence,record:"google_grounded"}},{...food,evidence:{...food.evidence,record:undefined}}]) {
      const thread=create(owner); const turn=begin(owner,thread,{kind:"message",text:"A food"});
      assert.throws(()=>finish(turn,{text:"Review",draft}),/Invalid reviewed food/);
      assert.equal(snapshot(owner,thread).pending,null);
      finish(turn,{error:"provider_unavailable"});
    }
    for (const source of ["usda","openfoodfacts","my_food","user_label","web","ai_estimate"]) {
      const thread=create(owner); const turn=begin(owner,thread,{kind:"message",text:"A food"});
      assert.equal(finish(turn,{text:"Review",draft:{...food,source,evidence:{...food.evidence,record:["my_food","user_label"].includes(source)?"user_owned":"independent"}}}).ok,true);
    }
  });

  await test("native owner servings retain unknown mass and reject fabricated conversions",() => {
    for(const [unit,amount,basis] of [["serving",2,{unit:"serving",count:1,milliliters:null}],["ml",200,{unit:"ml",count:null,milliliters:100}]]) {
      const thread=create(owner); const turn=begin(owner,thread,{kind:"message",text:"My own serving"});
      const native={...food,source:"my_food",grams:null,portion:{unit,amount},calories:310,protein:26,carbs:2,fat:22,evidence:{...food.evidence,record:"user_owned",basis:{...food.evidence.basis,...basis,grams:null}}};
      const reviewed=finish(turn,{text:"Review native unit",draft:native}).snapshot;
      assert.equal(reviewed.pending.food.grams,null);
      const saved=finish(begin(owner,reviewed.thread,{kind:"confirm",actionId:reviewed.pending.id,reviewVersion:reviewed.pending.review_version}),{}).snapshot;
      assert.deepEqual(JSON.parse(query(`select jsonb_build_object('unit',serving_unit,'amount',serving_size,'grams',bee_provenance#>'{food,grams}') from public.food_logs where id=${q(saved.saved_log_id)};`)),{unit,amount:String(amount),grams:null});
    }
    for(const invalid of [
      {...food,grams:null},
      {...food,grams:null,portion:{unit:"serving",amount:1},evidence:{...food.evidence,basis:{grams:null,unit:"ml",milliliters:100,count:null}}},
      {...food,grams:null,portion:{unit:"serving",amount:1},evidence:{...food.evidence,basis:{grams:null,unit:"serving",count:null}}},
      {...food,grams:undefined},
    ]) {
      const thread=create(owner); const turn=begin(owner,thread,{kind:"message",text:"Unknown conversion"});
      assert.throws(()=>finish(turn,{draft:invalid}),/Invalid reviewed food/); finish(turn,{error:"provider_unavailable"});
    }
  });

  await test("Grounded Results payloads cannot be persisted in turn state or reservation replays",()=>{
    const thread=create(owner); const turn=begin(owner,thread,{kind:"message",text:"Find a food"});
    const payload={text:"Grounded answer",citations:[{url:"https://example.test"}],searchSuggestionsHtml:["<p>Search</p>"]};
    assert.equal(finish(turn,{text:"Display only",state:{liveAnswer:payload}}).error,"bad_request");
    const request=randomUUID(); const token=randomUUID(); rpc("reserve_ai_lookup",[q(owner),q(request),q(request),q(token)]);
    assert.equal(rpc("release_ai_lookup",[q(owner),q(request),q(token),"true",json({liveAnswer:payload})]).error,"bad_request");
    assert.equal(query(`select result is null from public.ai_lookup_reservations where user_id=${q(owner)} and request_id=${q(request)};`),"t");
  });

  await test("scheduled retention removes aged content for inactive owners with server-only permission",()=>{
    const inactive=user(); const thread=create(inactive); finish(begin(inactive,thread,{kind:"message",text:"Inactive owner's old chat"}),{text:"Old answer"});
    query(`update public.bee_messages set created_at=now()-interval '31 days' where thread_id=${q(thread.id)}; update public.bee_turns set created_at=now()-interval '31 days' where thread_id=${q(thread.id)};`);
    query("select public.bee_prune_all_history();","service_role");
    assert.equal(query(`select count(*) from public.bee_messages where thread_id=${q(thread.id)};`),"0");
    assert.equal(query(`select count(*) from public.bee_turns where thread_id=${q(thread.id)};`),"0");
    assert.equal(query("select has_function_privilege('authenticated','public.bee_prune_all_history()','EXECUTE');"),"f");
    assert.equal(query("select has_function_privilege('anon','public.bee_prune_history(uuid)','EXECUTE');"),"f");
  });

  await test("clear_chat deletes replay snapshots and pending content while preserving diary and other owners",() => {
    const thread=create(owner);
    const turn=begin(owner,thread,{kind:"message",text:"Private chat before clearing"});
    const reviewed=finish(turn,{text:"Review",draft:food,state:{query:food.query,awaiting:"review"}}).snapshot;
    const saved=finish(begin(owner,reviewed.thread,{kind:"confirm",actionId:reviewed.pending.id,reviewVersion:reviewed.pending.review_version}),{}).snapshot;
    const pending=finish(begin(owner,saved.thread,{kind:"message",text:"Another serving"}),{text:"Review again",draft:food}).snapshot;
    const staleLoad=begin(owner,pending.thread,{kind:"load"});
    const other=create(stranger); finish(begin(stranger,other,{kind:"message",text:"Other owner's chat"}),{text:"Other answer"});
    const clear=begin(owner,pending.thread,{kind:"clear_chat"});
    assert.equal(clear.ok,true);
    const cleared=finish(clear,{text:"Chat cleared",state:{}});
    assert.equal(cleared.ok,true); assert.deepEqual(cleared.snapshot.messages,[]); assert.equal(cleared.snapshot.pending,null);
    assert.equal(query(`select count(*) from public.bee_messages where user_id=${q(owner)} and thread_id=${q(thread.id)};`),"0");
    assert.equal(query(`select count(*) from public.food_logs where user_id=${q(owner)} and id=${q(saved.saved_log_id)};`),"1");
    assert.equal(query(`select count(*) from public.bee_turns where user_id=${q(owner)} and result::text like '%Private chat before clearing%';`),"0");
    const loadRetry=begin(owner,pending.thread,{kind:"load"},staleLoad.request);
    assert.deepEqual(loadRetry.result.snapshot.messages,[]);
    assert.equal(begin(owner,cleared.snapshot.thread,{kind:"confirm",actionId:pending.pending.id,reviewVersion:pending.pending.review_version}).error,"stale_action");
    assert.equal(snapshot(stranger,other).messages.length,2);
    assert.deepEqual(begin(owner,pending.thread,{kind:"clear_chat"},clear.request).result,cleared);
  });

  await test("explicit preparation memory and clear-all remove all owner memories and old replay values",() => {
    const thread=create(owner);
    const saved=finish(begin(owner,thread,{kind:"memory_set",key:"usual_preparation",value:"boiled"}),{text:"Remembered"}).snapshot;
    assert.equal(saved.memories.find(m=>m.key==="usual_preparation").value,"boiled");
    const other=create(stranger); finish(begin(stranger,other,{kind:"memory_set",key:"preferred_name",value:"Other"}),{text:"Remembered"});
    const oldLoad=begin(owner,saved.thread,{kind:"load"});
    const clear=begin(owner,saved.thread,{kind:"memory_clear"}); assert.equal(clear.ok,true);
    const result=finish(clear,{text:"Memories cleared"}); assert.deepEqual(result.snapshot.memories,[]);
    assert.equal(query(`select count(*) from public.bee_memories where user_id=${q(owner)};`),"0");
    assert.deepEqual(begin(owner,saved.thread,{kind:"load"},oldLoad.request).result.snapshot.memories,[]);
    assert.equal(snapshot(stranger,other).memories[0].value,"Other");
  });

  await test("history retention physically deletes aged content and bounds current messages and replay snapshots",() => {
    const thread=create(owner);
    const old=begin(owner,thread,{kind:"message",text:"Expired secret chat"}); finish(old,{text:"Expired answer",state:{query:{name:"Expired secret chat"},awaiting:"none"}});
    query(`update public.bee_messages set created_at=now()-interval '31 days' where thread_id=${q(thread.id)}; update public.bee_turns set created_at=now()-interval '31 days' where thread_id=${q(thread.id)}; update public.bee_threads set updated_at=now()-interval '31 days' where id=${q(thread.id)};`);
    assert.deepEqual(snapshot(owner,thread).messages,[]);
    assert.equal(query(`select count(*) from public.bee_messages where thread_id=${q(thread.id)};`),"0");
    assert.equal(query(`select count(*) from public.bee_turns where thread_id=${q(thread.id)};`),"0");
    assert.equal(query(`select state::text like '%Expired secret chat%' from public.bee_threads where id=${q(thread.id)};`),"f");
    const content=begin(owner,snapshot(owner,thread).thread,{kind:"message",text:"Private cache outside retained history"});
    finish(content,{text:"An independently sourced answer"});
    const token=randomUUID(); rpc("reserve_ai_lookup",[q(owner),q(content.request),q(content.request),q(token)]);
    rpc("release_ai_lookup",[q(owner),q(content.request),q(token),"true",json({text:"Private cache outside retained history"})]);
    query(`insert into public.bee_messages(user_id,thread_id,role,text,created_at) select ${q(owner)},${q(thread.id)},'user','bounded-'||n,clock_timestamp()+n*interval '1 millisecond' from generate_series(1,70) n;`);
    const before=begin(owner,thread,{kind:"load"});
    const result=snapshot(owner,thread);
    assert.equal(result.messages.length,50); assert.equal(result.messages[0].text,"bounded-21");
    assert.equal(query(`select count(*) from public.bee_messages where thread_id=${q(thread.id)};`),"50");
    assert.equal(before.result.snapshot.messages.length,50);
    assert.equal(query(`select result is null from public.ai_lookup_reservations where user_id=${q(owner)} and request_id=${q(content.request)};`),"t");
  });

  await test("search launch caps are atomic, additional to core credits, and never refund launched requests",async()=>{
    const who=user(); const requests=Array.from({length:6},()=>({request:randomUUID(),token:randomUUID()}));
    for(const item of requests) assert.equal(rpc("reserve_ai_lookup",[q(who),q(item.request),q(item.request),q(item.token)]).ok,true);
    const args=(item)=>[q(who),q(item.request),q(item.token)];
    const results=await Promise.all(requests.map(item=>queryAsync(rpcSql("reserve_ai_search",args(item))).then(JSON.parse)));
    assert.equal(results.filter(r=>r.ok).length,3); assert.ok(results.filter(r=>!r.ok).every(r=>r.error==="rate_limited"));
    const index=results.findIndex(r=>r.ok); const item=requests[index];
    assert.equal(rpc("reserve_ai_search",args(item)).replay,true);
    assert.equal(rpc("reserve_ai_search",[q(stranger),q(item.request),q(item.token)]).error,"conflict");
    assert.equal(rpc("measure_ai_search",[...args(item),"4"]).ok,true);
    assert.equal(rpc("measure_ai_search",[...args(item),"4"]).replay,true);
    assert.equal(rpc("measure_ai_search",[...args(item),"5"]).error,"conflict");
    assert.equal(rpc("release_ai_lookup",[q(who),q(item.request),q(item.token),"false","null"]).ok,true);
    const fresh=randomUUID(); assert.equal(rpc("reserve_ai_lookup",[q(who),q(item.request),q(item.request),q(fresh)]).ok,true);
    assert.equal(rpc("reserve_ai_search",[q(who),q(item.request),q(fresh)]).replay,true);
    assert.equal(query(`select count(*) from public.ai_search_reservations where user_id=${q(who)};`),"3");
    assert.equal(query(`select sum(query_count) from public.ai_search_reservations where user_id=${q(who)};`),"4");
    for(const fn of ["reserve_ai_search(uuid,uuid,uuid)","measure_ai_search(uuid,uuid,uuid,integer)"]){
      assert.equal(query(`select has_function_privilege('authenticated','public.${fn}','EXECUTE');`),"f");
      assert.equal(query(`select has_function_privilege('service_role','public.${fn}','EXECUTE');`),"t");
    }
    assert.equal(query("select has_table_privilege('authenticated','public.ai_search_reservations','INSERT,UPDATE,DELETE');"),"f");
  });

  await test("Pro search cap stays twenty even with simultaneous requests near the limit",async()=>{
    const who=user(); query(`insert into public.entitlements(user_id,pro_until) values(${q(who)},now()+interval '1 day');`);
    query(`insert into public.ai_search_reservations(user_id,request_id,lease_token,day_period) select ${q(who)},gen_random_uuid(),gen_random_uuid(),to_char(now() at time zone 'UTC','YYYY-MM-DD') from generate_series(1,19);`);
    const items=Array.from({length:5},()=>({request:randomUUID(),token:randomUUID()}));
    for(const item of items) rpc("reserve_ai_lookup",[q(who),q(item.request),q(item.request),q(item.token)]);
    const results=await Promise.all(items.map(item=>queryAsync(rpcSql("reserve_ai_search",[q(who),q(item.request),q(item.token)])).then(JSON.parse)));
    assert.equal(results.filter(r=>r.ok).length,1); assert.equal(query(`select count(*) from public.ai_search_reservations where user_id=${q(who)};`),"20");
  });
  await test("recovering expired lookup workers respects the shared minute cap without extra daily credits",async()=>{
    const who=user(); query(`insert into public.entitlements(user_id,pro_until) values(${q(who)},now()+interval '1 day');`);
    const items=Array.from({length:20},()=>({request:randomUUID(),token:randomUUID()}));
    for(const item of items) query(`insert into public.ai_lookup_reservations(user_id,request_id,fingerprint,status,lease_token,expires_at,month_period,day_period) values(${q(who)},${q(item.request)},${q(item.request)},'reserved',gen_random_uuid(),now()-interval '1 second',to_char(now() at time zone 'UTC','YYYY-MM'),to_char(now() at time zone 'UTC','YYYY-MM-DD'));`);
    query(`insert into public.ai_usage(user_id,period,count) values(${q(who)},to_char(now() at time zone 'UTC','YYYY-MM'),20),(${q(who)},to_char(now() at time zone 'UTC','YYYY-MM-DD'),20);`);
    const seconds=new Date().getUTCSeconds();
    if(seconds>50) await new Promise(resolve=>setTimeout(resolve,(61-seconds)*1000));
    const results=await Promise.all(items.map(item=>queryAsync(rpcSql("reserve_ai_lookup",[q(who),q(item.request),q(item.request),q(item.token)])).then(JSON.parse)));
    assert.equal(results.filter(r=>r.ok).length,15); assert.ok(results.filter(r=>!r.ok).every(r=>r.error==="rate_limited"));
    assert.equal(query(`select count from public.ai_usage where user_id=${q(who)} and period=to_char(now() at time zone 'UTC','YYYY-MM-DD');`),"20");
    assert.equal(query(`select sum(count) from public.ai_usage where user_id=${q(who)} and length(period)=16;`),"15");
  });
  if(errors.length) throw new AggregateError(errors,"Bee migration invariants failed");
}
