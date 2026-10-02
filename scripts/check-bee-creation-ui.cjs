// Controlled illustrative TEST DATA. All auth/database/provider traffic is
// intercepted; these checks never modify a real user's library or diary.
const { chromium }=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const output='output/playwright/bee-creation';
const owner='11111111-1111-4111-8111-111111111111';
async function install(page){
  await require('./fixtures/bee-browser.cjs')(page);
  const recipes=[],personal=[],logs=[],calls=[];
  const thread={id:'22222222-2222-4222-8222-222222222222',version:0};
  const snapshot={thread,messages:[],memories:[],profile:{age:30},pending:null,entitlement:{tier:'pro',capabilities:{},limits:{},remaining:{},reset_at:null}};
  const completed=new Map();
  const fulfill=(route,value,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(value)});
  const food={name:'TEST DATA boiled egg',query:{name:'egg',preparation:'boiled',brand:null,variant:null,packageGrams:null,market:null,portion:{amount:100,unit:'g'}},portion:{amount:100,unit:'g'},grams:100,servingLabel:'100 g',source:'usda',calories:150,protein:12,carbs:2,fat:10,evidence:{identity:'TEST DATA boiled egg',url:'https://fdc.nal.usda.gov/food-details/123/nutrients',sourceId:'123',title:'USDA-like TEST DATA',retrievedAt:new Date().toISOString(),excerpt:'Controlled TEST DATA only',record:'independent',basis:{grams:100,unit:'g',count:null,milliliters:null,nutrients:{calories:150,protein:12,carbs:2,fat:10}}}};
  const recipe={kind:'recipe',name:'TEST DATA egg bowl',servings:2,instructions:['Cut the boiled egg.','Divide between two bowls.'],foods:[food],ingredients:[{name:food.name,brands:'',weight:100,unit:'g',default_unit:'g',nutriments:{'energy-kcal_100g':150,proteins_100g:12,carbohydrates_100g:2,fat_100g:10}}],totals:{calories:150,protein:12,carbs:2,fat:10}};
  const message=(role,text,draft)=>({id:`m-${thread.version}-${snapshot.messages.length}`,role,text,created_at:new Date().toISOString(),...(draft?{draft}:{})});
  const propose=(creation)=>{
    if(snapshot.pending)snapshot.pending.status='superseded';
    const draft={id:`33333333-3333-4333-8333-${String(thread.version).padStart(12,'0')}`,kind:creation.kind,creation,thread_id:thread.id,review_version:thread.version,status:'pending',expires_at:'2099-01-01T00:00:00Z',local_date:'2026-10-02',time_zone:'Asia/Manila'};
    snapshot.pending=draft;snapshot.messages.push(message('assistant','Review before saving to your library. Nothing has been logged.',draft));
  };
  for(const table of ['recipes','personal_foods','food_logs'])await page.route(`**/rest/v1/${table}**`,async route=>{
    const request=route.request(),url=new URL(request.url());
    if(request.method()==='GET'){
      assert.equal(url.searchParams.get('user_id'),`eq.${owner}`);
      const rows=table==='recipes'?recipes:table==='personal_foods'?personal:logs;
      return fulfill(route,request.headers().accept?.includes('object')?rows.find(row=>url.searchParams.get('id')===`eq.${row.id}`)??null:rows);
    }
    if(table==='food_logs'&&request.method()==='POST'){logs.push(...request.postDataJSON());return fulfill(route,null,201);}
    if(table==='recipes'&&request.method()==='PATCH'){
      const update=request.postDataJSON();assert.equal(url.searchParams.get('user_id'),`eq.${owner}`);
      const row=recipes.find(r=>url.searchParams.get('id')===`eq.${r.id}`);Object.assign(row,update);return fulfill(route,{id:row.id});
    }
    throw new Error('Unexpected direct library mutation: '+request.method());
  });
  await page.route('**/functions/v1/bee-chat',async route=>{
    const body=route.request().postDataJSON(),command=body.command;calls.push(body);
    if(completed.has(body.requestId))return fulfill(route,{ok:true,snapshot:completed.get(body.requestId)});
    delete snapshot.saved_action;
    if(command.kind==='message'){
      thread.version++;snapshot.messages.push(message('user',command.text));
      if(/4 servings/i.test(command.text))propose({...recipe,servings:4});
      else if(/create food/i.test(command.text))propose({kind:'personal_food',name:'TEST DATA boiled egg',defaultUnit:'g',nutrients:recipe.totals,food});
      else propose(recipe);
    } else if(command.kind==='confirm'){
      const p=snapshot.pending;assert.equal(command.actionId,p.id);assert.equal(command.reviewVersion,p.review_version);assert.equal(p.status,'pending');
      p.status='confirmed';thread.version++;
      const id='44444444-4444-4444-8444-'+String(thread.version).padStart(12,'0');
      if(p.kind==='recipe')recipes.push({id,user_id:owner,name:p.creation.name,ingredients:p.creation.ingredients,servings:p.creation.servings,instructions:p.creation.instructions,bee_action_id:p.id,bee_provenance:{creation:p.creation}});
      else personal.push({id,user_id:owner,name:p.creation.name,...p.creation.nutrients,default_unit:p.creation.defaultUnit,ai_estimated:false});
      snapshot.saved_action={kind:p.kind,id,pending_id:p.id,local_date:p.local_date};snapshot.pending=null;
      snapshot.messages.push(message('assistant',p.kind==='recipe'?'Recipe saved to Cookbook. Nothing added to your diary.':'Food saved to My Foods. Nothing added to your diary.'));
    } else if(command.kind==='cancel'){
      snapshot.pending.status='cancelled';snapshot.pending=null;thread.version++;snapshot.messages.push(message('assistant','Cancelled. Nothing was saved.'));
    }
    const copy=structuredClone(snapshot);completed.set(body.requestId,copy);return fulfill(route,{ok:true,snapshot:copy});
  });
  return {recipes,personal,logs,calls};
}
async function verify(browser,base,width){
  const context=await browser.newContext({viewport:{width,height:950}}),page=await context.newPage();
  const errors=[],failures=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  page.on('requestfailed',request=>{if(!request.failure()?.errorText?.includes('ERR_ABORTED'))failures.push(request.url());});
  const data=await install(page);
  try {
    await page.goto(base);
    await page.getByRole('button',{name:'Open Bee chat',exact:true}).click();
    const input=page.getByRole('textbox',{name:'Message to Bee',exact:true});await input.waitFor();
    await input.fill('Make me an egg bowl recipe');await page.getByRole('button',{name:'Send to Bee',exact:true}).click();
    await page.getByRole('button',{name:'Save to Cookbook',exact:true}).waitFor();
    await page.getByText('75 kcal',{exact:true}).waitFor();
    await page.getByText('1. Cut the boiled egg.',{exact:true}).waitFor();
    assert.equal(data.recipes.length,0);assert.equal(data.logs.length,0);
    await page.waitForTimeout(350);await page.screenshot({path:`${output}/recipe-review-${width}.png`,fullPage:true,animations:'disabled'});
    await page.getByRole('button',{name:'Edit recipe',exact:true}).click();
    await input.fill('Actually make it 4 servings');await page.getByRole('button',{name:'Send to Bee',exact:true}).click();
    await page.getByText('Makes 4 servings · Nutrition per serving',{exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Save to Cookbook',exact:true}).count(),1,'only the latest review can save');
    await page.getByRole('button',{name:'Save to Cookbook',exact:true}).press('Enter');
    await page.getByRole('button',{name:'Open Cookbook',exact:true}).waitFor();
    assert.equal(data.recipes.length,1);assert.equal(data.logs.length,0);
    await page.getByRole('button',{name:'Open Cookbook',exact:true}).click();
    await page.getByRole('button',{name:'Review TEST DATA egg bowl',exact:true}).click();
    await page.getByText('38',{exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Open Bee quick log',exact:true}).count(),0,'a mascot cannot cover the recipe confirmation');
    await page.getByText('1. Cut the boiled egg.',{exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Recipe portion 1 serving',exact:true}).getAttribute('aria-pressed'),'true');
    await page.waitForTimeout(350);await page.screenshot({path:`${output}/cookbook-serving-${width}.png`,fullPage:true,animations:'disabled'});
    await page.getByRole('button',{name:'Log reviewed recipe',exact:true}).click();
    await page.getByText("Added to today's food log.",{exact:true}).waitFor();
    assert.equal(data.logs.length,1);assert.equal(data.logs[0].serving_size,'0.25');assert.equal(data.logs[0].calories,38);
    await page.getByRole('button',{name:'Edit TEST DATA egg bowl',exact:true}).click();
    await page.getByRole('textbox',{name:'Recipe servings',exact:true}).waitFor();
    assert.equal(await page.getByRole('textbox',{name:'Recipe servings',exact:true}).inputValue(),'4');
    assert.equal(await page.getByRole('textbox',{name:'Recipe cooking steps',exact:true}).inputValue(),'Cut the boiled egg.\nDivide between two bowls.');
    await page.getByRole('textbox',{name:'Recipe servings',exact:true}).fill('3');
    await page.getByRole('textbox',{name:'Recipe cooking steps',exact:true}).fill('Cut the boiled egg.\nDivide between three bowls.');
    await page.screenshot({path:`${output}/recipe-editor-${width}.png`,fullPage:true,animations:'disabled'});
    await page.getByRole('button',{name:'Save recipe',exact:true}).click();
    await page.getByText('Recipe updated.',{exact:true}).waitFor();assert.equal(data.recipes[0].servings,3);assert.equal(data.logs.length,1);
    await page.getByRole('button',{name:'Open Bee quick log',exact:true}).click();
    await input.fill('Create food from this egg record');await page.getByRole('button',{name:'Send to Bee',exact:true}).click();
    await page.getByRole('button',{name:'Save to My Foods',exact:true}).waitFor();
    await page.getByText('Nutrition per 100 g',{exact:true}).waitFor();
    await page.screenshot({path:`${output}/food-review-${width}.png`,fullPage:true,animations:'disabled'});
    await page.getByRole('button',{name:'Cancel creation of TEST DATA boiled egg',exact:true}).click();
    assert.equal(data.personal.length,0);
    await input.fill('Create food from this egg record');await page.getByRole('button',{name:'Send to Bee',exact:true}).click();
    await page.getByRole('button',{name:'Save to My Foods',exact:true}).click();
    await page.getByRole('button',{name:'Open My Foods',exact:true}).waitFor();assert.equal(data.personal.length,1);assert.equal(data.logs.length,1);
    await page.getByRole('button',{name:'Open My Foods',exact:true}).click();
    await page.getByText('TEST DATA boiled egg',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
    assert.deepEqual(errors,[]);assert.deepEqual(failures,[]);
    return {width,recipeReview:true,oldReviewDisabled:true,librarySaveDoesNotLog:true,exactServingDiaryAddition:true,editableYieldAndInstructions:true,foodCancelAndSave:true,consoleErrors:0,failedRequests:0};
  }catch(error){await page.screenshot({path:`${output}/failure-${width}.png`,fullPage:true});throw error;}
  finally{await context.close();}
}
(async()=>{
  fs.mkdirSync(output,{recursive:true});
  const local=process.env.UI_BASE_URL?null:await require('./serve-web-export.cjs').serveExport();
  const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||'google-chrome',headless:true,args:['--no-sandbox']});
  const results=[];
  try{for(const width of [375,768,1440])results.push(await verify(browser,process.env.UI_BASE_URL||local.base,width));}
  finally{await browser.close();if(local)await new Promise(resolve=>local.server.close(resolve));}
  fs.writeFileSync(`${output}/results.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results));
})().catch(error=>{console.error(error);process.exit(1);});
