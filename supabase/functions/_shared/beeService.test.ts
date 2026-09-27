import { describe, expect, it, vi } from "vitest";
import { handleBeeRequest, type BeeStore, type BeeDependencies } from "./beeService.ts";
import type { BeeSnapshot, BeeResult } from "./beeTypes.ts";

const id="6d2f4d59-a884-49be-b7a8-e98d2c524ec9";
const snapshot:BeeSnapshot={thread:{id,version:0},messages:[],memories:[],profile:{},pending:null};
function setup() {
  const store:BeeStore={begin:vi.fn().mockResolvedValue({ok:true,replay:false,thread_id:id,token:id,state:{},pending:null}),snapshot:vi.fn().mockResolvedValue(snapshot),finish:vi.fn().mockImplementation(async(_request,_lease,outcome)=>({ok:true,snapshot:{...snapshot,messages:[{id,role:"assistant",text:outcome.text,created_at:"now"}]}})),reserve:vi.fn().mockResolvedValue({ok:true,replay:false}),release:vi.fn().mockResolvedValue(undefined),reserveSearch:vi.fn().mockResolvedValue({ok:true,replay:false,search_remaining:2}),measureSearch:vi.fn().mockResolvedValue(undefined),history:vi.fn().mockResolvedValue([])};
  const dependencies:BeeDependencies={authenticate:vi.fn().mockResolvedValue({id}),store:()=>store,interpret:vi.fn(),search:vi.fn(),configured:()=>true,ground:vi.fn(),searchEnabled:()=>true,now:()=>new Date("2026-09-14T16:01:00Z")};
  return {store,dependencies};
}
function request(text:string,extras:Record<string,unknown>={}) {return new Request("https://bee.test",{method:"POST",headers:{Authorization:"Bearer test", "Content-Type":"application/json"},body:JSON.stringify({requestId:id,threadId:id,expectedVersion:0,timeZone:"Asia/Manila",command:{kind:"message",text},...extras})});}
async function result(response:Response):Promise<BeeResult> {return response.json();}
describe("Bee endpoint enforcement",()=>{
  it("validates the JWT instead of accepting a nonempty Authorization header",async()=>{
    const {dependencies,store}=setup(); dependencies.authenticate=vi.fn().mockResolvedValue(null);
    expect((await handleBeeRequest(request("hello"),dependencies)).status).toBe(401);
    expect(store.begin).not.toHaveBeenCalled();
  });
  it("rejects oversized bodies, malformed commands and body-supplied owners",async()=>{
    const {dependencies,store}=setup();
    expect((await handleBeeRequest(request("x".repeat(9000)),dependencies)).status).toBe(400);
    expect((await handleBeeRequest(request("hello",{userId:id}),dependencies)).status).toBe(400);
    expect(store.begin).not.toHaveBeenCalled();
  });
  it.each(["Hi","No","Cancel","Yes","Remember that I prefer grams.","What do you remember about me?"])("%s makes no paid call",async text=>{
    const {dependencies,store}=setup(); await handleBeeRequest(request(text),dependencies);
    expect(store.reserve).not.toHaveBeenCalled(); expect(dependencies.search).not.toHaveBeenCalled(); expect(dependencies.interpret).not.toHaveBeenCalled();
  });
  it("retrieves yesterday from exact local start and next-day bounds",async()=>{
    const {dependencies,store}=setup(); await handleBeeRequest(request("What did I eat yesterday?"),dependencies);
    expect(store.history).toHaveBeenCalledWith("2026-09-13T16:00:00.000Z","2026-09-14T16:00:00.000Z");
    expect(store.reserve).not.toHaveBeenCalled();
  });
  it("recovers a successful completed request without repeating work",async()=>{
    const {dependencies,store}=setup(); store.begin=vi.fn().mockResolvedValue({ok:true,replay:true,result:{ok:true,snapshot:{...snapshot,saved_log_id:id}}});
    expect(await result(await handleBeeRequest(request("yes"),dependencies))).toMatchObject({ok:true,snapshot:{saved_log_id:id}});
    expect(store.finish).not.toHaveBeenCalled(); expect(store.reserve).not.toHaveBeenCalled();
  });
  it("denied ownership and concurrent turns cannot call paid services",async()=>{
    const {dependencies,store}=setup(); store.begin=vi.fn().mockResolvedValue({ok:false,error:"not_found"});
    expect(await result(await handleBeeRequest(request("72 g boiled egg"),dependencies))).toEqual({ok:false,error:"not_found"});
    expect(dependencies.interpret).not.toHaveBeenCalled();
  });
  it("fails safely for missing keys and failed providers, and releases the reservation",async()=>{
    const {dependencies,store}=setup(); dependencies.configured=()=>false;
    await handleBeeRequest(request("72 g boiled egg"),dependencies);
    expect(store.finish).toHaveBeenLastCalledWith(expect.anything(),expect.anything(),{error:"not_configured"});
    dependencies.configured=()=>true; dependencies.interpret=vi.fn().mockRejectedValue(new Error("timeout with sensitive internals"));
    await handleBeeRequest(request("72 g boiled egg"),dependencies);
    expect(store.release).toHaveBeenCalledWith(expect.anything(),expect.anything(),false,null);
    expect(store.finish).toHaveBeenLastCalledWith(expect.anything(),expect.anything(),{error:"provider_unavailable"});
  });
  it("model writes fail schema validation without touching food or memory",async()=>{
    const {dependencies,store}=setup(); dependencies.interpret=vi.fn().mockResolvedValue({kind:"confirm",sql:"insert into food_logs"});
    await handleBeeRequest(request("72 g boiled egg"),dependencies);
    expect(store.finish).toHaveBeenLastCalledWith(expect.anything(),expect.anything(),{error:"provider_unavailable"});
  });
});

// Grounding fixtures are display TEST DATA only and never nutrition drafts.
describe("live search boundary",()=>{
 const query={name:"unlisted dish",preparation:null,brand:null,variant:null,market:null,packageGrams:null,portion:{amount:100,unit:"g"}};
 const answer={text:"Live TEST answer",citations:[{url:"https://example.org/test",title:"Test citation",startIndex:0,endIndex:4}],searchSuggestionsHtml:["<div>Test suggestions</div>"],searchQueryCount:2};
 it("returns transient text but stores no grounded text, links, suggestions or food draft",async()=>{
   const {dependencies,store}=setup();dependencies.interpret=vi.fn().mockResolvedValue({kind:"nutrition",query});dependencies.search=vi.fn().mockResolvedValue({kind:"unavailable",message:"I couldn't verify nutrition."});dependencies.ground=vi.fn().mockResolvedValue(answer);
   expect(await result(await handleBeeRequest(request("nutrition question"),dependencies))).toMatchObject({ok:true,snapshot:{liveAnswer:answer}});
   expect(JSON.stringify(vi.mocked(store.finish).mock.calls)).not.toContain("example.org");expect(JSON.stringify(vi.mocked(store.release).mock.calls)).not.toContain("Live TEST");expect(store.measureSearch).toHaveBeenCalledWith(expect.anything(),expect.anything(),2);
 });
 it("does not launch search on a consumed reservation replay",async()=>{
   const {dependencies,store}=setup();dependencies.interpret=vi.fn().mockResolvedValue({kind:"nutrition",query});dependencies.search=vi.fn().mockResolvedValue({kind:"unavailable",message:"I couldn't verify nutrition."});store.reserveSearch=vi.fn().mockResolvedValue({ok:true,replay:true,search_remaining:2});
   await handleBeeRequest(request("nutrition question"),dependencies);expect(dependencies.ground).not.toHaveBeenCalled();
 });
});

describe("request deadline and failed-search accounting",()=>{
 it("an aborted incomplete request cannot hold a turn or call a provider",async()=>{
  const {dependencies,store}=setup();const controller=new AbortController();
  const body=new ReadableStream<Uint8Array>({start(c){c.enqueue(new TextEncoder().encode('{"requestId":'));}});
  const req=new Request('https://bee.test',{method:'POST',headers:{Authorization:'Bearer test','Content-Type':'application/json'},body,signal:controller.signal,duplex:'half'} as RequestInit);
  const work=handleBeeRequest(req,dependencies);controller.abort();expect((await work).status).toBe(400);expect(store.begin).not.toHaveBeenCalled();
 });
 it("a never-ending body reaches the5s deadline before acquiring a lease",async()=>{
  vi.useFakeTimers();try {
   const {dependencies,store}=setup();const body=new ReadableStream<Uint8Array>({start(c){c.enqueue(new TextEncoder().encode('{'));}});
   const req=new Request('https://bee.test',{method:'POST',headers:{Authorization:'Bearer test','Content-Type':'application/json'},body,duplex:'half'} as RequestInit);
   const work=handleBeeRequest(req,dependencies);await vi.advanceTimersByTimeAsync(5001);expect((await work).status).toBe(400);expect(store.begin).not.toHaveBeenCalled();
  }finally{vi.useRealTimers();}
 });
 it("records executed query counts even when returned citations fail validation",async()=>{
  const {dependencies,store}=setup();const query={name:'test dish',preparation:null,brand:null,variant:null,packageGrams:null,market:null,portion:{amount:100,unit:'g'}};
  dependencies.interpret=vi.fn().mockResolvedValue({kind:'nutrition',query});dependencies.search=vi.fn().mockResolvedValue({kind:'unavailable',message:"I couldn't verify nutrition."});
  dependencies.ground=vi.fn().mockImplementation(async(_q,_s,usage)=>{usage({inputTokens:12,outputTokens:6,searchQueries:2});throw new Error('unsafe markup');});
  await handleBeeRequest(request('nutrition question'),dependencies);expect(store.measureSearch).toHaveBeenCalledWith(expect.anything(),expect.anything(),2);expect(store.release).toHaveBeenCalledWith(expect.anything(),expect.anything(),false,null);expect(store.finish).toHaveBeenLastCalledWith(expect.anything(),expect.anything(),{error:'provider_unavailable'});
 });
});

it("explicit web requests bypass an independent hit and remain display-only",async()=>{
 const {dependencies}=setup(); const query={name:"test dish",preparation:null,brand:null,variant:null,market:null,packageGrams:null,portion:{amount:100,unit:"g"}};
 dependencies.interpret=vi.fn().mockResolvedValue({kind:"nutrition",query});dependencies.ground=vi.fn().mockResolvedValue({text:"TEST answer",citations:[],searchSuggestionsHtml:[],searchQueryCount:1});
 await handleBeeRequest(request("Search the web for this food"),dependencies);expect(dependencies.search).not.toHaveBeenCalled();expect(dependencies.ground).toHaveBeenCalledTimes(1);
});

it("a classifier dropping toast from a food list cannot produce an egg draft",async()=>{
 const {dependencies,store}=setup();const query={name:"egg",preparation:"boiled",brand:null,variant:null,market:null,packageGrams:null,portion:{amount:72,unit:"g"}};
 dependencies.interpret=vi.fn().mockResolvedValue({kind:"nutrition",query});
 await handleBeeRequest(request("How many calories in72g egg and toast?"),dependencies);
 expect(dependencies.search).not.toHaveBeenCalled();expect(dependencies.ground).not.toHaveBeenCalled();expect(JSON.stringify(vi.mocked(store.finish).mock.calls)).toContain("individually");
});
