// Synthetic TEST DATA only. All Supabase/provider calls are intercepted.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');
const output='output/playwright/label-photo';
async function verify(browser,base,width,jpeg){
 const context=await browser.newContext({viewport:{width,height:950},reducedMotion:'reduce'}),page=await context.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('requestfailed',r=>{if(!r.failure()?.errorText?.includes('ERR_ABORTED'))errors.push(r.url());});
 await require('./fixtures/bee-browser.cjs')(page);
 const thread={id:'22222222-2222-4222-8222-222222222222',version:0};
 const snapshot={thread,messages:[],memories:[],profile:{age:30},pending:null,entitlement:{tier:'plus',capabilities:{},limits:{requests:60,search:0,insights:0,input_tokens:160000,output_tokens:50000},remaining:{requests:60,search:0,insights:0,input_tokens:160000,output_tokens:50000},reset_at:null}};
 const calls=[],reads=[],logs=[],done=new Map();let partial=false,fail=false;
 const fulfill=(route,body)=>route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
 await page.route('**/rest/v1/rpc/account_entitlement',route=>fulfill(route,snapshot.entitlement));
 await page.route('**/functions/v1/billing',route=>fulfill(route,route.request().postDataJSON().action==='status'?{ok:true,entitlement:snapshot.entitlement,subscriptions:[]}:{ok:true,products:[],web_enabled:false}));
 await page.route('**/functions/v1/ai-label',async route=>{const body=route.request().postDataJSON();assert.match(body.image,/^data:image\/jpeg;base64,/);reads.push(body.requestId);if(fail)return fulfill(route,{ok:false,error:"provider_unavailable"});return fulfill(route,{ok:true,label:{foodName:'TEST DATA bar',basis:'per_serving',servingGrams:30,servingDescription:'1 bar',energy:418.4,energyUnit:'kJ',protein:partial?null:2,carbs:15,fat:3,warnings:[]}});});
 await page.route('**/functions/v1/bee-chat',async route=>{
  const body=route.request().postDataJSON(),c=body.command;calls.push(body);
  if(done.has(body.requestId))return fulfill(route,done.get(body.requestId));
  delete snapshot.saved_log_id;
  if(c.kind==='food_assist'&&/^Suggest some foods for /i.test(c.text)){
   thread.version++;snapshot.messages.push({id:`suggestion-${thread.version}`,role:'assistant',text:'TEST DATA food ideas: tofu or boiled egg. Choose one food and portion to check nutrition.',created_at:new Date().toISOString()});
  }else if(c.kind==='food_assist'){
   assert.match(c.text,/calories 100,/);assert.match(c.text,/portion 60 g/);thread.version++;
   const basis={grams:30,unit:'g',count:null,milliliters:null,nutrients:{calories:100,protein:2,carbs:15,fat:3}};
   const food={name:'TEST DATA bar',query:{name:'TEST DATA bar',preparation:null,brand:null,variant:null,packageGrams:null,market:null,portion:{amount:60,unit:'g'}},portion:{amount:60,unit:'g'},grams:60,servingLabel:'60 g',calories:200,protein:4,carbs:30,fat:6,source:'user_label',evidence:{identity:'TEST DATA bar',title:'Your reviewed label',url:'',record:'user_owned',retrievedAt:new Date().toISOString(),excerpt:'Explicitly reviewed TEST DATA',basis}};
   snapshot.pending={kind:'food',id:'33333333-3333-4333-8333-333333333333',thread_id:thread.id,review_version:thread.version,status:'pending',local_date:'2026-10-18',time_zone:'Asia/Manila',expires_at:'2099-01-01T00:00:00Z',food};
   snapshot.messages.push({id:`m${thread.version}`,role:'assistant',text:'Review your 60 g label serving. Add to today?',created_at:new Date().toISOString(),draft:snapshot.pending});
  }else if(c.kind==='confirm'){assert.equal(c.actionId,snapshot.pending.id);logs.push(snapshot.pending.food);snapshot.pending.status='confirmed';snapshot.pending=null;snapshot.saved_log_id='fixture-log';thread.version++;}
  const result={ok:true,snapshot:structuredClone(snapshot)};done.set(body.requestId,result);return fulfill(route,result);
 });
 try{
  await page.goto(base);await page.getByRole('button',{name:'Open Bee chat',exact:true}).click();
  await page.getByText('Read a nutrition label with your camera, get food suggestions, or check one food and portion. Pro adds web search and adaptive conversations.',{exact:true}).waitFor();
  await page.screenshot({path:`${output}/plus-access-${width}.png`,fullPage:true,animations:'disabled'});
  await page.getByRole('button',{name:'Get food suggestions',exact:true}).click();
  const input=page.getByRole('textbox',{name:'Message to Bee',exact:true});assert.equal(await input.inputValue(),'Suggest some foods for ');
  await input.fill('Suggest some foods for a simple lunch');await page.getByRole('button',{name:'Send to Bee',exact:true}).click();
  await page.getByText('TEST DATA food ideas: tofu or boiled egg. Choose one food and portion to check nutrition.',{exact:true}).waitFor();
  assert.equal(calls.at(-1).command.kind,'food_assist');assert.equal(logs.length,0);assert.equal(reads.length,0);
  await page.getByRole('button',{name:'Read a label photo',exact:true}).click();
  const choose=async()=>{const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Choose label photo',exact:true}).click();await (await chooser).setFiles({name:'TEST-label.jpg',mimeType:'image/jpeg',buffer:jpeg});await page.getByRole('button',{name:'Read label',exact:true}).waitFor();};
  await choose();assert.equal(reads.length,0,'selection alone must not upload');await page.getByRole('button',{name:'Read label',exact:true}).click();
  await page.getByRole('textbox',{name:'Food name',exact:true}).waitFor();assert.equal(logs.length,0);assert.equal(await page.getByRole('textbox',{name:'Energy on label',exact:true}).inputValue(),'418.4');
  await page.getByRole('textbox',{name:'Portion to review',exact:true}).fill('2');await page.screenshot({path:`${output}/review-${width}.png`,fullPage:true,animations:'disabled'});
  await page.getByRole('button',{name:'Review food',exact:true}).press('Enter');await page.getByRole('button',{name:'Add to today',exact:true}).waitFor();assert.equal(logs.length,0);
  await page.screenshot({path:`${output}/pending-${width}.png`,fullPage:true,animations:'disabled'});
  await page.getByRole('button',{name:'Add to today',exact:true}).click();await page.getByText("Added to today's food log.",{exact:true}).waitFor();assert.equal(logs.length,1);assert.equal(logs[0].calories,200);
  partial=true;await page.getByRole('button',{name:'Read a label photo',exact:true}).click();await choose();await page.getByRole('button',{name:'Read label',exact:true}).click();await page.getByRole('textbox',{name:'Protein (g)',exact:true}).waitFor();
  assert.equal(await page.getByRole('textbox',{name:'Protein (g)',exact:true}).inputValue(),'');const before=calls.length;await page.getByRole('button',{name:'Review food',exact:true}).click();await page.getByRole('alert').waitFor();assert.equal(calls.length,before);assert.equal(logs.length,1);
  await page.screenshot({path:`${output}/missing-macro-${width}.png`,fullPage:true,animations:'disabled'});
  await page.getByRole('button',{name:'Close label reader',exact:true}).click();assert.equal(await page.getByTestId('bee-label-panel').count(),0);
  fail=true;partial=false;await page.getByRole('button',{name:'Read a label photo',exact:true}).click();await choose();await page.getByRole('button',{name:'Read label',exact:true}).click();await page.getByRole('button',{name:'Read label again',exact:true}).waitFor();
  const failedId=reads.at(-1),count=reads.length;await page.waitForTimeout(100);assert.equal(reads.length,count,'no background paid retry');
  await page.screenshot({path:`${output}/provider-failure-${width}.png`,fullPage:true,animations:'disabled'});
  fail=false;await page.getByRole('button',{name:'Read label again',exact:true}).click();await page.getByRole('textbox',{name:'Food name',exact:true}).waitFor();assert.notEqual(reads.at(-1),failedId);assert.equal(logs.length,1);
  await page.getByRole('button',{name:'Close label reader',exact:true}).click();
  await page.goto(new URL('/plans',base).href);
  await page.getByText('60 shared requests each month for camera label reading, food suggestions and source-backed food help. Web search is included with Pro.',{exact:true}).waitFor();
  await page.getByText(/Everything in Plus, with 250 Bee interactions, 50 live web Search queries/).waitFor();
  await page.screenshot({path:`${output}/plans-${width}.png`,fullPage:true,animations:'disabled'});
  snapshot.entitlement.tier='basic';snapshot.messages=[];
  await page.goto(base);await page.getByRole('button',{name:'Open Bee chat',exact:true}).click();
  await page.getByText(/Plus adds camera label reading and food suggestions/).waitFor();
  assert.equal(await page.getByRole('button',{name:'Read a label photo',exact:true}).isDisabled(),true);
  assert.equal(await page.getByRole('button',{name:'Get food suggestions',exact:true}).count(),0);
  snapshot.entitlement.tier='pro';
  await page.goto(base);await page.getByRole('button',{name:'Open Bee chat',exact:true}).click();
  await page.getByRole('button',{name:'Make a recipe',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Read a label photo',exact:true}).isEnabled(),true);
  assert.equal(await page.getByRole('button',{name:'Get food suggestions',exact:true}).isEnabled(),true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);assert.deepEqual(errors,[]);
  console.log(`${width}px: Plus suggestions/label access, plan wording, photo preview, extraction, kJ/serving review, confirmed save, missing macro and cancel passed; no unexpected browser errors.`);
 }finally{await context.close();}
}
(async()=>{fs.mkdirSync(output,{recursive:true});const browser=await chromium.launch({headless:true,...(process.env.CHROME_BIN?{executablePath:process.env.CHROME_BIN}:{}),args:['--no-sandbox']});try{
 const p=await browser.newPage({viewport:{width:360,height:240}});await p.setContent('<main style="font:20px sans-serif;background:white;color:black">TEST DATA nutrition label<br>1 bar (30 g)<br>Energy 418.4 kJ<br>Protein 2 g · Carbs 15 g · Fat 3 g</main>');const jpeg=await p.screenshot({type:'jpeg'});await p.close();
 for(const width of [375,768,1440])await verify(browser,process.env.UI_BASE_URL||'http://127.0.0.1:8091',width,jpeg);
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
