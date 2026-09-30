// Controlled TEST DATA only. Every Auth/database/provider request is intercepted.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs=require('fs');const assert=require('assert/strict');
let base=process.env.UI_BASE_URL;
const output='output/playwright/account-ux';
const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
const user={id:'11111111-1111-4111-8111-111111111111',email:'test@example.test',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},identities:[],created_at:'2026-09-01T00:00:00Z'};
function session(){const exp=Math.floor(Date.now()/1000)+86400;return {access_token:`${encode({alg:'HS256',typ:'JWT'})}.${encode({sub:user.id,exp,aud:'authenticated',role:'authenticated'})}.test-data`,refresh_token:'test-data',token_type:'bearer',expires_in:86400,user};}
const json=(route,body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
async function authMock(page){
 const calls=[];
 await page.route('**/auth/v1/**',async route=>{
  const req=route.request();const path=new URL(req.url()).pathname;const body=req.postDataJSON();calls.push({path,method:req.method()});
  if(path.endsWith('/recover'))return json(route,{});
  if(path.endsWith('/verify'))return body.type==='recovery'&&body.token==='123456' ? json(route,session()) : json(route,{error_code:'otp_expired',msg:'Expired test code'},403);
  if(path.endsWith('/user'))return json(route,user);
  if(path.endsWith('/logout'))return route.fulfill({status:204,body:''});
  return json(route,{error:'unmocked_auth'},500);
 });return calls;
}
async function trackingMock(page){
 const requests=[];
 const tables={
  food_logs:[{id:'44444444-4444-4444-8444-444444444444',name:'TEST DATA cooked rice',calories:120,protein:2,carbs:25,fat:1,serving_size:'72',serving_unit:'g',created_at:'2026-09-29T04:00:00Z',ai_estimated:false}],
  weight_logs:[{id:'55555555-5555-4555-8555-555555555555',weight_kg:72.4,original_amount:72.4,unit:'kg',measured_at:'2026-09-29T00:00:00Z',local_date:'2026-09-29',time_zone:'Asia/Manila',source:'manual',created_at:'2026-09-29T00:00:00Z'}],
  user_goals:[{id:'66666666-6666-4666-8666-666666666666',time_zone:'Asia/Manila',calorie_target:2000,current_weight:72.4,age:30,height:170,goal_mode:'maintenance'}],
  personal_foods:[],recipes:[],bee_memories:[{key:'preferred_units',value:'grams',source:'explicit',created_at:'2026-09-29T00:00:00Z',updated_at:'2026-09-29T00:00:00Z'}],
 };
 await page.route('**/rest/v1/**',async route=>{
  const req=route.request();const url=new URL(req.url());const table=url.pathname.split('/').pop();
  if(!tables[table])return route.fallback();
  assert.equal(req.method(),'GET','these screens must never mutate a tracking table');
  assert.equal(url.searchParams.get('user_id'),'eq.'+user.id,'private reads need an explicit owner');
  requests.push({table,query:url.search});
  let records=tables[table];
  const key=table==='bee_memories'?'key':'id';
  if(url.searchParams.get(key)?.startsWith('gt.'))records=records.filter(row=>row[key]>url.searchParams.get(key).slice(3));
  const field=table==='weight_logs'?'measured_at':'created_at';
  for(const filter of url.searchParams.getAll(field)){
   if(filter.startsWith('gte.'))records=records.filter(row=>row[field]>=filter.slice(4));
   if(filter.startsWith('lt.'))records=records.filter(row=>row[field]<filter.slice(3));
  }
  return json(route,req.headers().accept?.includes('object') ? records[0]??null : records);
 });return requests;
}
(async()=>{
 fs.mkdirSync(output,{recursive:true});
 const local=base ? null : await require('./serve-web-export.cjs').serveExport();
 if(local)base=local.base;
 const browser=await chromium.launch({executablePath:process.env.CHROME_BIN || 'google-chrome',headless:true,args:['--no-sandbox']});const results=[];
 try {for(const width of [375,768,1440]){
  const context=await browser.newContext({viewport:{width,height:950},acceptDownloads:true});const page=await context.newPage();const errors=[];const failed=[];
  page.on('pageerror',error=>errors.push(String(error)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('requestfailed',r=>{if(!r.failure()?.errorText?.includes('ERR_ABORTED'))failed.push(r.url());});
  const auth=await authMock(page);
  await page.goto(base+'/');await page.getByRole('button',{name:'Forgot password?',exact:true}).click();
  await page.getByRole('textbox',{name:'Recovery email address'}).fill('test@example.test');
  await page.getByRole('button',{name:'Send recovery code',exact:true}).click();
  const code=page.getByRole('textbox',{name:'Recovery verification code'});await code.waitFor();
  await code.fill('000000');await page.getByRole('textbox',{name:'New password',exact:true}).fill('Fixture-only-password1!');await page.getByRole('textbox',{name:'Repeat new password',exact:true}).fill('Fixture-only-password1!');
  await page.getByRole('button',{name:'Save new password',exact:true}).click();await page.getByText('That code is invalid or expired. Check it or request a new code.',{exact:true}).waitFor();
  assert.equal(auth.filter(call=>call.path.endsWith('/user')&&call.method==='PUT').length,0);
  await page.screenshot({path:`${output}/recovery-invalid-${width}.png`,fullPage:true});
  await code.fill('123456');await page.getByRole('button',{name:'Save new password',exact:true}).click();await page.getByRole('heading',{name:'Password changed',exact:true}).waitFor();
  assert.equal(auth.filter(call=>call.path.endsWith('/user')&&call.method==='PUT').length,1);
  assert.equal(await page.evaluate(()=>Object.keys(localStorage).some(key=>key.includes('password-recovery'))),false,'recovery sessions must not be persisted');
  await page.screenshot({path:`${output}/recovery-success-${width}.png`,fullPage:true});
  for(const route of ['/data','/diary']){await page.goto(base+route);await page.getByRole('button',{name:'Forgot password?',exact:true}).waitFor();assert.equal(await page.getByRole('heading',{name:route==='/data'?'Your tracking data':'Food diary',exact:true}).count(),0);}
  const fixture=await require('./fixtures/bee-browser.cjs')(page);const reads=await trackingMock(page);
  await page.goto(base+'/diary');const date=page.getByRole('textbox',{name:'Diary date',exact:true});await date.waitFor();
  await page.getByText('No food entries saved for this day.',{exact:true}).waitFor();
  await date.fill('2026-09-29');await page.getByRole('button',{name:'Show day',exact:true}).click();await page.getByText('TEST DATA cooked rice',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('Daily total 120 calories').count(),1);
  await page.screenshot({path:`${output}/diary-history-${width}.png`,fullPage:true});
  await page.getByRole('button',{name:'Previous day',exact:true}).click();await page.getByText('No food entries saved for this day.',{exact:true}).waitFor();assert.equal(await page.getByText('TEST DATA cooked rice',{exact:true}).count(),0);
  await page.getByRole('button',{name:'Next day',exact:true}).click();await page.getByText('TEST DATA cooked rice',{exact:true}).waitFor();
  await date.fill('2026-02-30');await page.getByRole('button',{name:'Show day',exact:true}).click();await page.getByText('Enter a real date as YYYY-MM-DD.',{exact:true}).waitFor();
  await page.goto(base+'/data');await page.getByRole('textbox',{name:'Export start date',exact:true}).waitFor();
  await page.getByRole('textbox',{name:'Export start date',exact:true}).fill('2026-09-29');await page.getByRole('textbox',{name:'Export end date',exact:true}).fill('2026-09-29');
  let waiting=page.waitForEvent('download');await page.getByRole('button',{name:'Food diary CSV',exact:true}).click();let download=await waiting;await download.saveAs(`${output}/food-${width}.csv`);assert.match(fs.readFileSync(`${output}/food-${width}.csv`,'utf8'),/TEST DATA cooked rice/);
  waiting=page.waitForEvent('download');await page.getByRole('button',{name:'Download tracking JSON',exact:true}).click();download=await waiting;await download.saveAs(`${output}/tracking-${width}.json`);const data=JSON.parse(fs.readFileSync(`${output}/tracking-${width}.json`,'utf8'));assert.equal(data.food_logs.length,1);assert.equal(data.weight_logs.length,1);assert.equal(data.bee_memories[0].value,'grams');assert.equal(data.range.from,'2026-09-29');assert.equal(data.range.to,'2026-09-29');assert.equal(data.range.timeZone,'Asia/Manila');assert.equal(data.session,undefined);
  await page.screenshot({path:`${output}/download-success-${width}.png`,fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'export overflow');
  assert.deepEqual(errors.filter(error=>!error.includes('403')),[]);assert.deepEqual(failed,[]);
  assert.equal(fixture.requests.filter(r=>r.path==='/rest/v1/food_logs'&&r.method!=='GET').length,0);
  results.push({width,recoverySendInvalidValid:true,recoveryNotPersisted:true,privateRoutesGuarded:true,localDiaryHistoryEmptyInvalid:true,downloadCsvJson:true,ownerScopedReads:reads.length,unexpectedConsoleErrors:0,failedRequests:0});await context.close();
 }} finally {await browser.close();if(local)await new Promise(resolve=>local.server.close(resolve));}
 fs.writeFileSync(`${output}/results.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results));
})().catch(error=>{console.error(error);process.exit(1);});
