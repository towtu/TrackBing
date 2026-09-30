import {describe,it,expect,vi} from 'vitest';
import {handleBeeRequest,type BeeDependencies,type BeeStore} from './beeService.ts';
import type {BeeSnapshot,BeeEntitlement,BeeRequest} from './beeTypes.ts';
import type {FoodQuery,ReviewedFood} from './beeTypes.ts';
const id='11111111-1111-4111-8111-111111111111';
const snapshot:BeeSnapshot={thread:{id,version:0},messages:[],memories:[],profile:{age:30,current_weight:72,calorie_target:2000},pending:null};
function setup(tier:BeeEntitlement['tier']='pro'){
 const entitlement={tier,capabilities:{},remaining:{requests:250},limits:{},reset_at:null};
 const store:BeeStore={entitlement:vi.fn().mockResolvedValue(entitlement),progress:vi.fn().mockResolvedValue({localDate:'2026-09-27',totals:{calories:0,protein:0,carbs:0,fat:0,count:0},weights:[],recentLogTimes:[],revision:'1'}),recordCall:vi.fn(),getInsight:vi.fn().mockResolvedValue(null),saveInsight:vi.fn().mockImplementation(async(revision,timezone,text,pose)=>({text,suggested_pose:pose,context_revision:revision,expires_at:'2026-09-28T00:00:00Z'})),begin:vi.fn().mockResolvedValue({ok:true,replay:false,thread_id:id,token:id,state:{},pending:null}),snapshot:vi.fn().mockResolvedValue(snapshot),finish:vi.fn().mockImplementation(async(_request,_lease,outcome)=>outcome.error?{ok:false,error:outcome.error}:{ok:true,snapshot:{...snapshot,messages:outcome.text?[{id,role:'assistant',text:outcome.text,created_at:'now'}]:[],pending:outcome.weight_draft?{...snapshot.pending,kind:'weight',weight:outcome.weight_draft}:null}}),reserve:vi.fn().mockResolvedValue({ok:true,replay:false}),release:vi.fn(),reserveSearch:vi.fn().mockResolvedValue({ok:true,replay:false}),measureSearch:vi.fn(),history:vi.fn().mockResolvedValue([])};
 const deps:BeeDependencies={authenticate:vi.fn().mockResolvedValue({id}),store:()=>store,generate:vi.fn().mockResolvedValue({reply:'Your diary has no entries today. Would you like help reviewing a food?',nextStep:'answer',suggestedPose:'encouraging'}),interpret:vi.fn(),search:vi.fn(),ground:vi.fn(),configured:()=>true,paidDataApproved:()=>true,searchEnabled:()=>true,now:()=>new Date('2026-09-27T03:00:00Z')};
 return {deps,store};
}
const request=(text='How am I doing today?',kind='message')=>new Request('https://example.test/bee',{method:'POST',headers:{Authorization:'Bearer test-data','Content-Type':'application/json'},body:JSON.stringify({requestId:id,threadId:id,expectedVersion:0,timeZone:'Asia/Manila',command:{kind,text}})});
describe('adaptive server decisions and paid boundaries',()=>{
 it.each(['basic','plus'] as const)('never spends on adaptive chat for %s',async tier=>{const {deps,store}=setup(tier);const response=await handleBeeRequest(request(),deps);expect(response.status).toBe(402);expect(deps.generate).not.toHaveBeenCalled();expect(store.reserve).not.toHaveBeenCalled();});
 it('lets Basic read actual owned yesterday without a paid call',async()=>{const {deps,store}=setup('basic');expect((await handleBeeRequest(request('What did I eat yesterday?'),deps)).status).toBe(200);expect(store.history).toHaveBeenCalledWith('2026-09-25T16:00:00.000Z','2026-09-26T16:00:00.000Z');expect(deps.generate).not.toHaveBeenCalled();});
 it.each(['missing','minor','unpaid'] as const)('fails before exposing context or spending when %s',async mode=>{const {deps,store}=setup();store.snapshot=vi.fn().mockResolvedValue({...snapshot,profile:{age:mode==='minor'?17:mode==='missing'?null:30}});if(mode==='unpaid')deps.paidDataApproved=()=>false;expect((await handleBeeRequest(request(),deps)).status).toBe(mode==='unpaid'?503:403);expect(deps.generate).not.toHaveBeenCalled();expect(store.reserve).not.toHaveBeenCalled();});
 it('a fresh no-search reply uses real state and one quota reservation without logging',async()=>{const {deps,store}=setup();const result=await(await handleBeeRequest(request(),deps)).json();expect(result.ok).toBe(true);expect(store.reserve).toHaveBeenCalledOnce();expect(deps.generate).toHaveBeenCalledOnce();expect(deps.search).not.toHaveBeenCalled();expect(deps.ground).not.toHaveBeenCalled();expect(store.finish).toHaveBeenCalledWith(expect.anything(),expect.anything(),expect.not.objectContaining({confirm:true}));expect(store.recordCall).toHaveBeenCalledOnce();});
 it('explicit weight becomes only a review, converted on the server, never a claimed save',async()=>{const {deps,store}=setup();deps.generate=vi.fn().mockResolvedValueOnce({reply:'Let us review that check-in.',nextStep:'propose_weight',suggestedPose:'thinking'}).mockResolvedValueOnce({reply:'Review your measurement below. Your targets stay unchanged.',suggestedPose:'thinking'});await handleBeeRequest(request('My weight today is 160 lb'),deps);const outcome=vi.mocked(store.finish).mock.calls.at(-1)![2];expect(outcome.weight_draft?.weightKg).toBeCloseTo(72.5747792);expect(outcome.confirm).toBeUndefined();expect(outcome.goal_draft).toBeUndefined();expect(store.recordCall).toHaveBeenCalledTimes(2);});
 it('malformed decisions and fake save claims cannot create proposals',async()=>{for(const output of [{reply:'I saved your weight.',nextStep:'propose_weight',suggestedPose:'success'},{reply:'Do this.',nextStep:'execute_sql',sql:'delete users',suggestedPose:'thinking'}]){const {deps,store}=setup();deps.generate=vi.fn().mockResolvedValue(output);const result=await(await handleBeeRequest(request('My weight is 72 kg'),deps)).json();expect(result.ok).toBe(false);expect(store.release).toHaveBeenCalledWith(expect.anything(),expect.anything(),false,null);expect(vi.mocked(store.finish).mock.calls.at(-1)![2]).not.toHaveProperty('weight_draft');}});
 it('an unchanged cached dashboard insight does not reserve or call the model',async()=>{const {deps,store}=setup();store.getInsight=vi.fn().mockResolvedValue({text:'A previously generated current insight.',suggested_pose:'greeting',context_revision:'1',expires_at:'2026-09-28T00:00:00Z'});const req=new Request('https://example.test',{method:'POST',headers:{Authorization:'Bearer test','Content-Type':'application/json'},body:JSON.stringify({requestId:id,threadId:id,expectedVersion:0,timeZone:'Asia/Manila',command:{kind:'insight'}})});expect((await handleBeeRequest(req,deps)).status).toBe(200);expect(store.reserve).not.toHaveBeenCalled();expect(deps.generate).not.toHaveBeenCalled();});
 it('the authoritative saved timezone wins over a different device zone',async()=>{const {deps,store}=setup('basic');deps.savedTimeZone=async()=> 'America/New_York';await handleBeeRequest(request('What did I eat yesterday?'),deps);expect(vi.mocked(store.begin).mock.calls[0][0].timeZone).toBe('America/New_York');});
 it('Plus nutrition clarification uses no private weight or goal context and no Search',async()=>{const {deps,store}=setup('plus');deps.generate=vi.fn().mockResolvedValue({kind:'clarify',question:'Which flavor and single-bar size?',query:null});await handleBeeRequest(request('Calories in one Fudgee Barr?','food_assist'),deps);expect(deps.ground).not.toHaveBeenCalled();expect(JSON.stringify(vi.mocked(deps.generate!).mock.calls)).not.toContain('current_weight');expect(store.progress).not.toHaveBeenCalled();});
});

describe('gist then Search then USDA and retained preparation',()=>{
 const query:FoodQuery={name:'chicken breast',preparation:'raw skinless',brand:null,variant:null,packageGrams:null,market:null,portion:{amount:609,unit:'g'}};
 // TEST DATA: not a nutrition claim about chicken or a live Google result.
 const food:ReviewedFood={name:'TEST DATA raw skinless chicken breast',query,portion:query.portion!,grams:609,servingLabel:'609 g',calories:609,protein:60.9,carbs:12.2,fat:24.4,source:'usda',evidence:{identity:'TEST DATA raw skinless chicken breast',url:'https://fdc.nal.usda.gov/food-details/123/nutrients',title:'TEST DATA independent source',retrievedAt:'2026-09-27T00:00:00Z',excerpt:'TEST DATA',record:'independent',basis:{grams:100,unit:'g',count:null,milliliters:null,nutrients:{calories:100,protein:10,carbs:2,fat:4}}}};
 const answer={text:'TEST DATA live answer only',citations:[{title:'TEST source',url:'https://example.org/test',startIndex:0,endIndex:9}],searchSuggestionsHtml:['<a href="https://www.google.com/search?q=test">Test</a>'],searchQueryCount:1};
 it('runs Search before the independent USDA fallback and never persists Google data',async()=>{
  const {deps,store}=setup();const order:string[]=[];
  deps.generate=vi.fn().mockResolvedValue({reply:'Let me check the requested food.',nextStep:'lookup_food',suggestedPose:'searching',query});
  deps.search=vi.fn().mockImplementation(async()=>{order.push('gist');return {kind:'unavailable',message:"I couldn't verify nutrition."};});
  deps.ground=vi.fn().mockImplementation(async()=>{order.push('google');return answer;});
  deps.fallbackSearch=vi.fn().mockImplementation(async received=>{order.push('usda');expect(received).toEqual(query);return {kind:'found',food};});
  const response=await handleBeeRequest(request('609 g raw skinless chicken breast'),deps);
  expect(order).toEqual(['gist','google','usda']);expect(response.status).toBe(200);
  expect(vi.mocked(store.finish).mock.calls.at(-1)?.[2]).toMatchObject({draft:food});
  expect(JSON.stringify(vi.mocked(store.finish).mock.calls)).not.toContain('example.org');
  expect(JSON.stringify(vi.mocked(store.release).mock.calls)).not.toContain(answer.text);
 });
 it('an independent gist match calls neither Google nor USDA',async()=>{
  const {deps}=setup();deps.generate=vi.fn().mockResolvedValue({reply:'Review the matching curated record.',nextStep:'lookup_food',suggestedPose:'thinking',query});
  deps.search=vi.fn().mockResolvedValue({kind:'found',food:{...food,source:'trackbing_gist'}});deps.fallbackSearch=vi.fn();
  await handleBeeRequest(request('609 g raw skinless chicken breast'),deps);
  expect(deps.ground).not.toHaveBeenCalled();expect(deps.fallbackSearch).not.toHaveBeenCalled();
 });
 it('raw bypasses a classifier that would change chicken to Cobra and makes no write',async()=>{
  const {deps,store}=setup();vi.mocked(store.begin).mockResolvedValue({ok:true,replay:false,thread_id:id,token:id,state:{awaiting:'clarification',query:{...query,preparation:'grilled skinless'}},pending:null});
  deps.generate=vi.fn().mockRejectedValue(new Error('Classifier must not see this correction'));deps.search=vi.fn().mockResolvedValue({kind:'found',food});
  await handleBeeRequest(request('raw'),deps);
  expect(deps.search).toHaveBeenCalledWith(query,expect.any(AbortSignal),id);expect(deps.generate).not.toHaveBeenCalled();
  expect(vi.mocked(store.finish).mock.calls.at(-1)?.[2].confirm).toBeUndefined();
 });
 it('a failed Google call can still return a genuine USDA review',async()=>{
  const {deps,store}=setup();deps.generate=vi.fn().mockResolvedValue({reply:'Checking.',nextStep:'lookup_food',suggestedPose:'searching',query});
  deps.search=vi.fn().mockResolvedValue({kind:'unavailable',message:"I couldn't verify nutrition."});deps.ground=vi.fn().mockRejectedValue(new Error('provider timeout'));
  deps.fallbackSearch=vi.fn().mockResolvedValue({kind:'found',food});
  expect((await handleBeeRequest(request('609 g raw skinless chicken breast'),deps)).status).toBe(200);
  expect(vi.mocked(store.finish).mock.calls.at(-1)?.[2]).toMatchObject({draft:food});
 });
});
