// Real Edge Function runtime, with fixed in-memory upstreams. No production
// connection, application secret or billable provider call is possible.
import assert from "node:assert/strict";
function assertEquals(actual: unknown, expected: unknown): void { assert.deepEqual(actual, expected); }

const owner = "12345678-1234-4234-8234-123456789abc";
const settings: Record<string,string> = {
  SUPABASE_URL:"https://supabase.test",SUPABASE_ANON_KEY:"fixture-anon-key",
  SUPABASE_SERVICE_ROLE_KEY:"fixture-service-key",USDA_API_KEY:"fixture-usda-key",
};
let handler: (request: Request) => Promise<Response>;
Object.defineProperty(Deno,"serve",{value:(value: typeof handler)=>{handler=value;}});
Object.defineProperty(Deno.env,"get",{value:(name:string)=>settings[name]});
const calls: {url:string;authorization:string|null;body:unknown}[]=[];
let authAllowed=true;
let reservation: unknown={ok:true,remaining:29};
let reservationStatus=200;
globalThis.fetch=async(input: RequestInfo | URL, init?: RequestInit):Promise<Response>=>{
  const url=String(input),headers=new Headers(init?.headers);
  const body=init?.body?JSON.parse(String(init.body)):null;
  calls.push({url,authorization:headers.get("authorization"),body});
  if(url==="https://supabase.test/auth/v1/user") return new Response(JSON.stringify(authAllowed?{id:owner,aud:"authenticated",email:"fixture@example.test"}:{message:"Invalid JWT"}),{status:authAllowed?200:401,headers:{"content-type":"application/json"}});
  if(url==="https://supabase.test/rest/v1/rpc/reserve_usda_request") return new Response(JSON.stringify(reservation),{status:reservationStatus,headers:{"content-type":"application/json"}});
  if(url.startsWith("https://api.nal.usda.gov/fdc/v1/foods/search?")) return new Response(JSON.stringify({foods:[],totalHits:0,currentPage:1,totalPages:0}),{headers:{"content-type":"application/json"}});
  throw new Error("Unexpected upstream destination");
};
await import("../functions/usda-search/index.ts");
function reset(){calls.length=0;authAllowed=true;reservation={ok:true,remaining:29};reservationStatus=200;}
function request(body:unknown={query:"boiled egg"},authorization="Bearer fixture-valid-jwt"){return new Request("https://edge.test/usda-search",{method:"POST",headers:{authorization,"content-type":"application/json"},body:JSON.stringify(body)});}
const providers=()=>calls.filter(call=>call.url.includes("api.nal.usda.gov"));
const reservations=()=>calls.filter(call=>call.url.endsWith("reserve_usda_request"));

Deno.test("USDA quota denial is HTTP429 with Retry-After and never calls the provider",async()=>{
  reset();reservation={ok:false,error:"rate_limited",retry_after:12};
  const response=await handler(request());
  assertEquals(response.status,429);assertEquals(response.headers.get("retry-after"),"12");
  assertEquals(await response.json(),{error:"rate_limited"});assertEquals(providers().length,0);
  assertEquals(reservations()[0].body,{p_user:owner});
});
Deno.test("USDA validates the real session before reserving the server-owned limit",async()=>{
  reset();authAllowed=false;
  assertEquals((await handler(request())).status,401);assertEquals(reservations().length,0);assertEquals(providers().length,0);
  assert(calls[0].url.endsWith("auth/v1/user"));assertEquals(calls[0].authorization,"Bearer fixture-valid-jwt");
});
Deno.test("USDA never reserves malformed or user-owner injected bodies",async()=>{
  for(const body of [{query:"egg",user_id:"other"},{query:""},{query:"egg",pageSize:101},{query:"egg",dataType:["injected"]}]){
    reset();assertEquals((await handler(request(body))).status,400);assertEquals(reservations().length,0);assertEquals(providers().length,0);
  }
});
Deno.test("USDA database failure and malformed quota results fail closed",async()=>{
  for(const value of [{status:500,body:{message:"Private database diagnostic"}},{status:200,body:{}},{status:200,body:null}]){
    reset();reservationStatus=value.status;reservation=value.body;
    const response=await handler(request());assertEquals(response.status,503);assertEquals(await response.json(),{error:"nutrition_unavailable"});assertEquals(providers().length,0);
  }
});
Deno.test("USDA success keeps the existing result contract and counts before provider launch",async()=>{
  reset();const response=await handler(request({query:"egg",pageSize:3}));
  assertEquals(response.status,200);assertEquals((await response.json()).foods,[]);
  assertEquals(reservations().length,1);assertEquals(providers().length,1);
  assert(calls.indexOf(reservations()[0])<calls.indexOf(providers()[0]));
  assertEquals(providers()[0].body,{query:"egg",dataType:["Foundation","SR Legacy","Survey (FNDDS)","Branded"],pageSize:3,pageNumber:1});
  assertEquals(response.headers.get("cache-control"),"no-store");
});
