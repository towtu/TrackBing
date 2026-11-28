// Controlled browser verification. Install Playwright separately; no live user writes.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs=require('fs');const assert=require('assert/strict');
async function verifyScannerPreview(page) {
 await page.waitForFunction(()=>{
  const video=document.querySelector('video');
  return video?.readyState>=HTMLMediaElement.HAVE_CURRENT_DATA
   && video.srcObject instanceof MediaStream
   && video.srcObject.getVideoTracks().some(track=>track.readyState==='live');
 },null,{timeout:10000});
}
async function verifyManualFoodReview(page, width, fixture, output) {
 const baseUrl=process.env.UI_BASE_URL || 'http://127.0.0.1:8091';
 // Illustrative TEST DATA delivered through the existing scanner/manual entry path.
 const params=new URLSearchParams({initialName:'TEST DATA oats',initialCal:'205',initialProt:'10',initialCarbs:'30',initialFat:'5',initialWeight:'100',initialUnit:'g',brand:'Browser fixture'});
 const writes=()=>fixture.requests.filter(r=>r.path==='/rest/v1/food_logs'&&r.method==='POST').length;
 const before=writes();
 await page.goto(`${baseUrl}/add?${params}`);
 const portion=page.getByRole('textbox',{name:'Food portion',exact:true});
 await portion.waitFor();
 assert.equal(await page.getByRole('button',{name:'Close food review',exact:true}).count(),1);
 assert.equal(await page.getByRole('button',{name:'Log this meal',exact:true}).count(),1);
 await page.getByRole('button',{name:'Increase portion',exact:true}).click();
 assert.equal(await portion.inputValue(),'110');
 await page.getByRole('button',{name:'Decrease portion',exact:true}).click();
 assert.equal(await portion.inputValue(),'100');
 assert.equal(await page.getByRole('button',{name:'Portion unit g, selected',exact:true}).count(),1);
 await page.screenshot({path:`${output}/manual-food-review-${width}.png`});
 await page.getByRole('button',{name:'Close food review',exact:true}).press('Enter');
 await portion.waitFor({state:'hidden'});
 assert.equal(writes(),before,'closing the review must not insert a food');
}
async function verifyBarcodeRegistration(page, width, output) {
 const base = process.env.UI_BASE_URL || 'http://127.0.0.1:8091';
 const code = '00480123';
 const json = (route, body) => route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
 let personal = null;
 let catalog = null;
 let publisher = false;
 let publicLookups = 0;
 const saveBodies = [];
 const diaryBodies = [];
 await page.route('**/auth/v1/user', route => json(route, {id:'11111111-1111-4111-8111-111111111111'}));
 await page.route('**/rest/v1/rpc/can_share_barcodes', route => json(route, publisher));
 await page.route('**/rest/v1/rpc/lookup_shared_barcode', route =>
  json(route, route.request().postDataJSON().p_barcode === catalog?.barcode ? catalog.label : null));
 await page.route('**/rest/v1/food_logs**', route => {
  const request = route.request();
  if(request.method()!=='POST' || request.postDataJSON()?.[0]?.name!=='TEST DATA barcode snack') return route.fallback();
  diaryBodies.push(request.postDataJSON()[0]);
  return route.fulfill({status:201});
 });
 await page.route('**/rest/v1/personal_foods**', route => {
  const request = route.request();
  if (request.method() === 'POST') {
   const body = request.postDataJSON()[0];
   saveBodies.push(body);
   personal = {...body, id:'test-food'};
   return route.fulfill({status:201});
  }
  const filter = new URL(request.url()).searchParams.get('barcode');
  return json(route, filter ? filter === 'eq.' + personal?.barcode ? personal : null : personal ? [personal] : []);
 });
 await page.route('https://world.openfoodfacts.org/api/v0/product/**', route => {
  publicLookups++;
  return json(route, {status:0});
 });
 const button = name => page.getByRole('button',{name,exact:true});
 const textbox = name => page.getByRole('textbox',{name,exact:true});
 const scan = async (barcode=code) => {
  await page.goto(base + '/scan');
  await button('Type barcode').click();
  await textbox('Barcode number').fill(barcode);
  await button('Search barcode').click();
 };
 const fillLabel = async (grams) => {
  await textbox('Food name').fill('TEST DATA barcode snack');
  await textbox('Calories from label').fill('125');
  await textbox('Protein in grams').fill('4');
  await textbox('Carbohydrate in grams').fill('20');
  await textbox('Fat in grams').fill('3');
  await textbox('Serving weight in grams').fill(String(grams));
 };
 await scan();
 await page.getByText('Create this food',{exact:true}).click();
 await page.getByText('Nutrition on the label',{exact:true}).waitFor();
 assert.equal(await textbox('Barcode number').inputValue(),code);
 const perServing = page.getByRole('radio',{name:'Per serving',exact:true});
 assert.equal(await perServing.getAttribute('aria-checked'),'true');
 assert.equal(await page.getByRole('radio').count(),2);
 assert.equal(await page.getByRole('checkbox',{name:/Share this label/}).count(),0);
 await page.getByRole('radio',{name:'Per 100 g',exact:true}).click();
 await page.getByText('Protein (per 100 g)',{exact:true}).waitFor();
 await perServing.click();
 await fillLabel(35);
 await page.screenshot({path:`${output}/barcode-label-${width}.png`,fullPage:true});
 await button('Save Food').click();
 await page.getByText('Food saved to your My Foods.',{exact:true}).waitFor();
 assert.equal(saveBodies.length,1);
 assert.equal(saveBodies[0].default_unit,'serving');
 assert.equal(saveBodies[0].calories,125);
 assert.equal(saveBodies[0].serving_grams,35);
 assert.equal(saveBodies[0].barcode,code);
 assert.equal(saveBodies[0].share_barcode,undefined);
 await scan();
 await textbox('Food portion').waitFor();
 assert.equal(await textbox('Food portion').inputValue(),'35');
 assert.equal(await button('Portion unit g, selected').count(),1);
 assert.equal(publicLookups,1,'re-scanning the saved label skips the public source');
 await button('Portion unit serving').click();
 assert.equal(await textbox('Food portion').inputValue(),'1');
 await button('Portion unit g').click();
 assert.equal(await textbox('Food portion').inputValue(),'35');
 await textbox('Food portion').fill('209');
 await page.getByText('746',{exact:true}).waitFor();
 await page.screenshot({path:`${output}/barcode-review-${width}.png`,fullPage:true});
 await button('Log this meal').click();
 await page.waitForFunction(() => !document.querySelector('[aria-label="Food portion"]'));
 assert.equal(diaryBodies.length,1);
 assert.equal(diaryBodies[0].serving_size,'209');
 assert.equal(diaryBodies[0].serving_unit,'g');
 assert.equal(diaryBodies[0].calories,746);

 publisher = true;
 await page.goto(base + '/create-food?barcode=00480124');
 await fillLabel(41);
 const checkbox = page.getByRole('checkbox',{name:/Share this label/});
 await checkbox.waitFor();
 assert.equal(await checkbox.getAttribute('aria-checked'),'false');
 await checkbox.click();
 await button('Save Food').click();
 await page.getByText('Food saved to My Foods and shared for barcode lookup.',{exact:true}).waitFor();
 assert.equal(saveBodies[1].share_barcode,true);
 assert.equal(saveBodies[1].serving_grams,41);
 const {name,calories,protein,carbs,fat,default_unit,serving_grams,barcode}=saveBodies[1];
 catalog={barcode,label:{name,calories,protein,carbs,fat,default_unit,serving_grams}};
 personal=null;
 publisher=false;
 await scan(barcode);
 await textbox('Food portion').waitFor();
 assert.equal(await textbox('Food portion').inputValue(),'41');
 assert.equal(await button('Portion unit g, selected').count(),1);
 assert.equal(await page.getByText('TrackBing catalog',{exact:true}).count(),1);
 assert.equal(publicLookups,1,'a shared label carries its grams without a public lookup');
}
async function verifyBeeCorrections(page,width,fixture,output) {
 const input=page.getByRole('textbox',{name:/Message to Bee/i});
 const send=async text=>{await input.fill(text);await page.getByRole('button',{name:/Send to Bee/i}).click();};
 const mascot=page.getByTestId('bee-dashboard-companion').locator('[data-testid^="bee-mascot-"]');
 const searchBefore=fixture.getSearchCount();
 await send('I ate 609 grams of skinless chicken breast');
 await page.getByText('Was the chicken breast weighed raw or after cooking?',{exact:true}).waitFor();
 await send('ra');await page.getByText('Did you mean raw chicken breast?',{exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Add to today',exact:true}).count(),0);
 assert.equal(await mascot.count(),1);await page.screenshot({path:`${output}/raw-clarification-${width}.png`});
 await send('yes');await page.getByRole('button',{name:'Add to today',exact:true}).waitFor();
 const first=fixture.getSnapshot().pending;
 assert.equal(first.food.grams,609);assert.equal(first.food.query.preparation,'raw skinless');
 assert.equal(fixture.requests.filter(r=>r.path==='/rest/v1/food_logs'&&r.method==='POST').length,0);
 assert.equal(await mascot.count(),1);assert.equal(await page.getByText(/Carbohydrates 12.2 g/).count()>0,true);
 assert.equal(await page.getByText(/P60.9 C12.2 F24.4/).count(),0);
 assert.equal(await page.getByText(/Cobra/).count(),0);
 await page.screenshot({path:`${output}/raw-food-review-${width}.png`});
 await send('Actually, make it 100 grams');await page.getByText('100 kcal',{exact:true}).waitFor();
 const latest=fixture.getSnapshot().pending;assert.notEqual(latest.id,first.id);assert.equal(latest.food.grams,100);
 await page.getByRole('button',{name:'Add to today',exact:true}).first().waitFor();
 try {await page.waitForFunction(()=>Array.from(document.querySelectorAll('[role=button],button')).filter(el=>el.textContent==='Add to today').length===1,{},{timeout:4000});}
 catch(error){await page.screenshot({path:`${output}/correction-failure-${width}.png`});fs.writeFileSync(`${output}/correction-failure.json`,JSON.stringify({snapshot:fixture.getSnapshot(),buttons:await page.getByRole('button',{name:'Add to today',exact:true}).evaluateAll(nodes=>nodes.map(n=>n.outerHTML)),text:await page.locator('[aria-label="Bee conversation"]').innerText()},null,2));throw error;}
 assert.equal(await page.getByRole('button',{name:'Add to today',exact:true}).count(),1,'superseded review must have no Add button');
 assert.equal(await mascot.count(),1);await page.screenshot({path:`${output}/corrected-review-${width}.png`});
 await send('no');await page.getByText('Cancelled. Nothing was saved.',{exact:true}).waitFor();
 assert.equal(fixture.getSnapshot().pending,null);assert.equal(fixture.getSearchCount(),searchBefore);
 assert.equal(await page.getByRole('button',{name:'Add to today',exact:true}).count(),0);
}
async function verifyGettingStarted(page, base, width, output) {
 const fixture = await require('./fixtures/bee-browser.cjs')(page, {createdAt:new Date(Date.now()-60000).toISOString()});
 const card = page.getByTestId('getting-started-card');
 const button = name => card.getByRole('button',{name,exact:true});
 const aligned = async target => {
  const testId = target === 'bee' ? 'bee-dashboard-companion' : `getting-started-target-${target}`;
  await page.waitForFunction(id => {
   const anchor = [...document.querySelectorAll(`[data-testid="${id}"]`)]
    .map(element=>element.getBoundingClientRect())
    .find(rect=>rect.height>0 && rect.width>0);
   const outline = document.querySelector('[data-testid="getting-started-spotlight"]')?.getBoundingClientRect();
   return anchor && outline && anchor.height > 0 && Math.abs(anchor.left-outline.left) <= 6 &&
    Math.abs(anchor.top-outline.top) <= 6 && outline.height >= anchor.height;
  },testId);
  const outline = await page.getByTestId('getting-started-spotlight').boundingBox();
  const panel = await card.boundingBox();
  assert.ok(panel.x+panel.width<=outline.x || outline.x+outline.width<=panel.x || panel.y>=outline.y+outline.height,
   `tour copy must leave the ${target} highlight visible at ${width}px`);
 };
 const checkStep = async (step,path,target) => {
  await page.waitForURL(url=>url.pathname===path);
  await card.getByText(`Step ${step} of 12`,{exact:true}).waitFor();
  await aligned(target);
 };
 await page.goto(base);
 await card.getByRole('heading',{name:'Getting started',exact:true}).waitFor();
 await checkStep(1,'/','calories');
 await page.screenshot({path:`${output}/getting-started-calories-${width}.png`,animations:'disabled'});
 if(width===375){
  for(const viewport of [{width:700,height:400},{width:320,height:568}]){
   await page.setViewportSize(viewport);
   await aligned('calories');
   await page.screenshot({path:`${output}/getting-started-${viewport.width}x${viewport.height}.png`,animations:'disabled'});
  }
  await page.setViewportSize({width,height:900});
  await aligned('calories');
 }
 const itinerary = [
  [2,'/add','log'],[3,'/add','scan'],[4,'/diary','diary'],[5,'/my-foods','foods'],
  [6,'/cookbook','cookbook'],[7,'/stats','stats'],[8,'/stats','weight'],[9,'/profile','profile'],
  [10,'/','bee'],[11,'/plans','plans'],[12,'/data','export'],
 ];
 for(const [step,path,target] of itinerary){
  await button('Next').click();
  await checkStep(step,path,target);
  if(step===4){
   await button('Back').click();
   await checkStep(3,'/add','scan');
   await button('Next').click();
   await checkStep(4,'/diary','diary');
  }
  if(step===3 || step===8 || step===12){
   await page.screenshot({path:`${output}/getting-started-${target}-${width}.png`,animations:'disabled'});
  }
 }
 assert.ok(!fixture.requests.some(({path,method})=>method!=='GET' &&
  (/\/rest\/v1\/(food_logs|weight_logs|user_goals)$/.test(path) || /\/functions\/v1\/(billing-checkout|ai-food)$/.test(path))),
 'following the tour does not create foods, weigh-ins or purchases');
 if(width===375){
  await button('Skip tour').click();
  assert.equal(new URL(page.url()).pathname,'/data');
 }else{
  await button('Done').click();
  await page.waitForURL(url=>url.pathname==='/');
 }
 await page.waitForFunction(()=>localStorage.getItem('trackbing:getting-started:v2:11111111-1111-4111-8111-111111111111')==='seen');
 await page.goto(base);
 await page.getByRole('progressbar',{name:'Calories logged',exact:true}).waitFor();
 await card.waitFor({state:'hidden'});
 if(width===375) await page.goto(base+'/profile');
 await page.getByRole('button',{name:'Getting started',exact:true}).click();
 await checkStep(1,'/','calories');
 await button('Skip tour').click();
 await card.waitFor({state:'hidden'});
}

// A synthetic camera keeps the scanner check independent of runner hardware and permissions.
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROME_BIN || 'google-chrome',headless:true,args:['--no-sandbox','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']});const output='output/playwright/adaptive-launch';fs.mkdirSync(output,{recursive:true});const evidence=[];
 for(const width of [375,768,1440]){
 const context=await browser.newContext({viewport:{width,height:900}});const page=await context.newPage();const errors=[];const failedRequests=[];page.on('requestfailed',r=>{if(!r.failure()?.errorText?.includes('ERR_ABORTED'))failedRequests.push({url:r.url(),error:r.failure()?.errorText});});page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
 for(const route of ['/','/privacy','/terms','/unknown-controlled-test']){const response=await page.goto((process.env.UI_BASE_URL || 'http://127.0.0.1:8091')+route);await page.waitForTimeout(400);const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);assert.equal(overflow,false,route+' overflow '+width);await page.screenshot({path:`${output}/public-${width}-${route.replaceAll('/','_')||'home'}.png`,fullPage:true});if(route.includes('unknown'))assert.equal(response.status(),404);if(route==='/privacy'||route==='/terms')assert.equal(await page.locator('script').count(),0);}
 // The deliberate HTTP404 is an expected browser resource diagnostic.
 const unexpected=errors.filter(e=>!e.includes('404'));assert.deepEqual(unexpected,[]);
 const fixture=await require('./fixtures/bee-browser.cjs')(page);await page.goto((process.env.UI_BASE_URL || 'http://127.0.0.1:8091'));await page.waitForTimeout(1800);
 for(const route of ['/','/add','/scan','/profile','/stats','/plans']){
  await page.goto((process.env.UI_BASE_URL || 'http://127.0.0.1:8091')+route);
  await page.waitForTimeout(800);
  if(route==='/scan')await verifyScannerPreview(page);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,route+' overflow '+width);
  if(route==='/'){
   await page.getByText('Calculated from your profile · View',{exact:true}).first().waitFor();
   const progress=page.getByRole('progressbar',{name:'Calories logged',exact:true});
   assert.equal(await progress.count(),1,'calorie ring exposes actual progress to assistive technology');
   assert.equal(await progress.getAttribute('aria-valuenow'),'0');
   assert.equal(await progress.getAttribute('aria-valuemax'),'2000');
  }
  if(route==='/add'){
   assert.equal(await page.getByRole('button',{name:'Create a food',exact:true}).count(),1,'icon-only Create Food control needs an accessible name');
   if(width===375){for(const label of ['Go back','Open my foods','Scan a barcode'])assert.equal(await page.getByRole('button',{name:label,exact:true}).count(),1,`${label} needs an accessible name`);}
  }
  await page.screenshot({path:`${output}/account-${width}-${route.slice(1)}.png`,fullPage:true});
 }
 await verifyManualFoodReview(page,width,fixture,output);
 await verifyBarcodeRegistration(page,width,output);
 await page.goto((process.env.UI_BASE_URL || 'http://127.0.0.1:8091')+'/');await page.waitForTimeout(700);await page.getByRole('button',{name:'Open Bee chat',exact:true}).click();await page.waitForTimeout(200);
 const input=page.getByRole('textbox',{name:/Message to Bee/i});await input.fill('My weight today is 72.4 kg');await page.getByRole('button',{name:/Send to Bee/i}).click();await page.getByText('Save 72.4 kg for 2026-09-27?',{exact:true}).waitFor();await page.screenshot({path:`${output}/weight-review-${width}.png`});await page.getByRole('button',{name:'Confirm',exact:true}).click();await page.getByText('Weight check-in saved.',{exact:true}).first().waitFor();assert.equal(fixture.getSnapshot().pending,null);
 await verifyBeeCorrections(page,width,fixture,output);
 await input.fill('How many calories in 72 grams of boiled egg?');await page.getByRole('button',{name:/Send to Bee/i}).click();await page.getByRole('button',{name:'Add to today',exact:true}).waitFor();await page.screenshot({path:`${output}/food-review-${width}.png`});await page.getByRole('button',{name:/^Cancel /}).click();
 // TEST DATA: only a confirmed fixture entry should change the dashboard's progress.
 await input.fill('How many calories in 72 grams of boiled egg?');await page.getByRole('button',{name:/Send to Bee/i}).click();await page.getByRole('button',{name:'Add to today',exact:true}).waitFor();
 assert.equal(await page.getByRole('progressbar',{name:'Calories logged',exact:true}).getAttribute('aria-valuenow'),'0');
 await page.getByRole('button',{name:'Add to today',exact:true}).click();await page.getByText("Added that reviewed serving to today's food log.",{exact:true}).waitFor();
 await page.getByRole('button',{name:'Close Bee quick log',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('[role="progressbar"][aria-label="Calories logged"]')?.getAttribute('aria-valuenow')==='111.6');
 await page.screenshot({path:`${output}/dashboard-confirmed-food-${width}.png`,fullPage:true});
 await page.getByRole('button',{name:'Open Bee chat',exact:true}).click();
 await input.fill('Fudgee Barr Chocolate 38 g nutrition');await page.getByRole('button',{name:/Send to Bee/i}).click();await page.getByText('Live answer',{exact:true}).waitFor();assert.equal(fixture.getSnapshot().pending,null);assert.equal(await page.locator('[data-testid^="bee-mascot-"]').count(),1);assert.equal(await page.locator('[aria-label="Google Search suggestions"]').count(),1);await page.screenshot({path:`${output}/search-answer-${width}.png`});await page.getByRole('button',{name:'Saved preferences',exact:true}).click();await page.getByRole('heading',{name:'Saved preferences',exact:true}).waitFor();await page.screenshot({path:`${output}/memories-${width}.png`});
 const tourPage=await context.newPage();
 tourPage.on('pageerror',e=>errors.push(String(e)));
 tourPage.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 tourPage.on('requestfailed',r=>{if(!r.failure()?.errorText?.includes('ERR_ABORTED'))failedRequests.push({url:r.url(),error:r.failure()?.errorText});});
 await verifyGettingStarted(tourPage,process.env.UI_BASE_URL || 'http://127.0.0.1:8091',width,output);
 await tourPage.close();
 assert.deepEqual(errors.filter(e=>!e.includes('404')),[]);assert.deepEqual(failedRequests,[]);
 evidence.push({failedRequests,width,publicRoutes:4,accountRoutes:6,cameraPreviewStarted:true,singleActiveCompanion:true,readableMacros:true,rawTypoClarification:true,retainedPortion:true,staleAddHidden:true,noCancelsWithoutSearch:true,manualFoodReviewAdjustCancel:true,weightReviewConfirm:true,foodReviewCancel:true,calorieProgressAfterConfirmation:true,memories:true,gettingStartedSpotlight:true,errors:errors.filter(e=>!e.includes('404'))});await context.close();}
 await browser.close();fs.writeFileSync(output+'/results.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));})().catch(e=>{console.error(e);process.exit(1)});
