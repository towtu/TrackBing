// Controlled browser verification. Install Playwright separately; no live user writes.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs=require('fs');const assert=require('assert/strict');
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
async function verifyBeeCorrections(page,width,fixture,output) {
 const input=page.getByRole('textbox',{name:/Message to Bee/i});
 const send=async text=>{await input.fill(text);await page.getByRole('button',{name:/Send to Bee/i}).click();};
 const mascot=page.getByTestId('bee-latest-message-mascot');
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
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROME_BIN || 'google-chrome',headless:true,args:['--no-sandbox']});const output='output/playwright/adaptive-launch';fs.mkdirSync(output,{recursive:true});const evidence=[];
 for(const width of [375,768,1440]){
 const context=await browser.newContext({viewport:{width,height:900}});const page=await context.newPage();const errors=[];const failedRequests=[];page.on('requestfailed',r=>{if(!r.failure()?.errorText?.includes('ERR_ABORTED'))failedRequests.push({url:r.url(),error:r.failure()?.errorText});});page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
 for(const route of ['/','/privacy','/terms','/unknown-controlled-test']){const response=await page.goto((process.env.UI_BASE_URL || 'http://127.0.0.1:8091')+route);await page.waitForTimeout(400);const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);assert.equal(overflow,false,route+' overflow '+width);await page.screenshot({path:`${output}/public-${width}-${route.replaceAll('/','_')||'home'}.png`,fullPage:true});if(route.includes('unknown'))assert.equal(response.status(),404);if(route==='/privacy'||route==='/terms')assert.equal(await page.locator('script').count(),0);}
 // The deliberate HTTP404 is an expected browser resource diagnostic.
 const unexpected=errors.filter(e=>!e.includes('404'));assert.deepEqual(unexpected,[]);
 const fixture=await require('./fixtures/bee-browser.cjs')(page);await page.goto((process.env.UI_BASE_URL || 'http://127.0.0.1:8091'));await page.waitForTimeout(1800);
 for(const route of ['/','/add','/scan','/profile','/stats','/plans']){await page.goto((process.env.UI_BASE_URL || 'http://127.0.0.1:8091')+route);await page.waitForTimeout(800);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,route+' overflow '+width);if(route==='/add'){assert.equal(await page.getByRole('button',{name:'Create a food',exact:true}).count(),1,'icon-only Create Food control needs an accessible name');if(width===375){for(const label of ['Go back','Open my foods','Scan a barcode'])assert.equal(await page.getByRole('button',{name:label,exact:true}).count(),1,`${label} needs an accessible name`);}}await page.screenshot({path:`${output}/account-${width}-${route.slice(1)}.png`,fullPage:true});}
 await verifyManualFoodReview(page,width,fixture,output);
 await page.goto((process.env.UI_BASE_URL || 'http://127.0.0.1:8091')+'/');await page.waitForTimeout(700);await page.getByRole('button',{name:/Open Bee/i}).click();await page.waitForTimeout(200);
 const input=page.getByRole('textbox',{name:/Message to Bee/i});await input.fill('My weight today is 72.4 kg');await page.getByRole('button',{name:/Send to Bee/i}).click();await page.getByText('Save 72.4 kg for 2026-09-27?',{exact:true}).waitFor();await page.screenshot({path:`${output}/weight-review-${width}.png`});await page.getByRole('button',{name:'Confirm',exact:true}).click();await page.getByText('Weight check-in saved.',{exact:true}).first().waitFor();assert.equal(fixture.getSnapshot().pending,null);
 await verifyBeeCorrections(page,width,fixture,output);
 await input.fill('How many calories in 72 grams of boiled egg?');await page.getByRole('button',{name:/Send to Bee/i}).click();await page.getByRole('button',{name:'Add to today',exact:true}).waitFor();await page.screenshot({path:`${output}/food-review-${width}.png`});await page.getByRole('button',{name:/^Cancel /}).click();await input.fill('Fudgee Barr Chocolate 38 g nutrition');await page.getByRole('button',{name:/Send to Bee/i}).click();await page.getByText('Live answer',{exact:true}).waitFor();assert.equal(fixture.getSnapshot().pending,null);assert.equal(await page.getByTestId('bee-latest-message-mascot').count(),1);assert.equal(await page.locator('[aria-label="Google Search suggestions"]').count(),1);await page.screenshot({path:`${output}/search-answer-${width}.png`});await page.getByRole('button',{name:'Saved preferences',exact:true}).click();await page.getByRole('heading',{name:'Saved preferences',exact:true}).waitFor();await page.screenshot({path:`${output}/memories-${width}.png`});
 assert.deepEqual(errors.filter(e=>!e.includes('404')&&!e.includes('NotAllowedError')),[]);assert.deepEqual(failedRequests,[]);
 evidence.push({failedRequests,width,publicRoutes:4,accountRoutes:6,latestAssistantMascot:true,readableMacros:true,rawTypoClarification:true,retainedPortion:true,staleAddHidden:true,noCancelsWithoutSearch:true,manualFoodReviewAdjustCancel:true,weightReviewConfirm:true,foodReviewCancel:true,memories:true,errors:errors.filter(e=>!e.includes('404')&&!e.includes('NotAllowedError')),expectedCameraDenials:errors.filter(e=>e.includes('NotAllowedError')).length});await context.close();}
 await browser.close();fs.writeFileSync(output+'/results.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));})().catch(e=>{console.error(e);process.exit(1)});
