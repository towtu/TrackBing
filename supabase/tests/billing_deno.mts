// Controlled provider and database fixtures; no real credentials, accounts, or payment requests.
import assert from "node:assert/strict";
import {webSubscription,checkWebPlan,providerJson} from "../functions/_shared/billingProviders.ts";
const owner="12345678-1234-4234-8234-123456789abc";
const settings:Record<string,string>={SUPABASE_URL:"https://supabase.test",SUPABASE_ANON_KEY:"fixture-anon",SUPABASE_SERVICE_ROLE_KEY:"fixture-service",PAYMONGO_SECRET_KEY:"fixture-secret",PAYMONGO_WEBHOOK_SECRET:"fixture-hook",PAYMONGO_LIVE:"false",BILLING_PRODUCTS_JSON:JSON.stringify([{provider:"web",id:"plan_fixture_plus",tier:"plus",interval:"monthly"},{provider:"web",id:"plan_fixture_pro",tier:"pro",interval:"monthly"}])};
Object.defineProperty(Deno.env,"get",{value:(name:string)=>settings[name]});
let handler!:(r:Request)=>Promise<Response>; let webhook:typeof handler;
Object.defineProperty(Deno,"serve",{value:(h:typeof handler)=>{handler=h;}});
let auth=true,large=false,paid=true,invoice="inv_fixture",plan="plan_fixture_plus",eventSeen=false;
const calls:{url:string;body:unknown}[]=[];
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json"}});
const subscription=()=>({id:"subs_fixture",type:"subscription",attributes:{customer_id:"cus_fixture",anchor_date:"2026-09-01",next_billing_schedule:"2026-10-01",status:"active",updated_at:Date.now()/1000,plan:{id:plan,amount:plan.endsWith("pro")?59900:24900,currency:"PHP"},latest_invoice:{id:invoice,status:paid?"paid":"open",payment_intent:{id:"pi_fixture",status:paid?"succeeded":"awaiting_payment_method"}}}});
globalThis.fetch=async(input:RequestInfo|URL,init?:RequestInit):Promise<Response>=>{
 const url=String(input),body=init?.body?JSON.parse(String(init.body)):null;calls.push({url,body});
 if(url.endsWith("/auth/v1/user"))return json(auth?{id:owner,email:"fixture@example.test",aud:"authenticated"}:{message:"Invalid JWT"},auth?200:401);
 if(url.includes("/rpc/resolve_entitlement"))return json({tier:"basic",limits:{},remaining:{}});
 if(url.includes("/rpc/reconcile_subscription")){eventSeen=true;return json({ok:true,entitlement:{tier:"plus"}});}
 if(url.includes("/billing_web_checkouts?"))return json({user_id:owner});
 if(url.includes("/subscriptions?"))return json(url.includes("external_id=")?null:[]);
 if(url.includes("/billing_web_payment_links?"))return json(null);
 if(url==="https://api.paymongo.com/v1/subscriptions/subs_fixture")return json({data:subscription()});
 if(url==="https://api.paymongo.com/v1/payment_intents/pi_fixture")return json({data:{id:"pi_fixture",attributes:{payments:[]}}});
 if(url.includes("/subscriptions/plans/"))return json({data:{attributes:{amount:24900,currency:"PHP",interval:"month",interval_count:1}}});
 if(url==="https://fixture.test/provider")return large?new Response('x'.repeat(150001),{headers:{"content-type":"application/json"}}):json({ok:true});
 throw new Error(`Unexpected fixture destination: ${url}`);
};
await import("../functions/billing/index.ts");const billing=handler;
await import("../functions/billing-webhook/index.ts");webhook=handler;
function reset(){calls.length=0;auth=true;large=false;paid=true;invoice="inv_fixture";plan="plan_fixture_plus";eventSeen=false;}
const request=(body:unknown)=>new Request("https://edge.test/billing",{method:"POST",headers:{authorization:"Bearer fixture-session","content-type":"application/json"},body:JSON.stringify(body)});
async function signed(body:unknown){const raw=JSON.stringify(body),t=Math.floor(Date.now()/1000);const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(settings.PAYMONGO_WEBHOOK_SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const bytes=new Uint8Array(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(`${t}.${raw}`)));return new Request("https://edge.test/billing-webhook?provider=web",{method:"POST",headers:{"content-type":"application/json","Paymongo-Signature":`t=${t},te=${Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join("")}`},body:raw});}
Deno.test("Billing rejects an invalid session before any provider or database mutation",async()=>{reset();auth=false;assert.equal((await billing(request({action:"verify_google",token:"fixture"}))).status,401);assert.equal(calls.length,1);});
Deno.test("Billing rejects manipulated owner, price and entitlement inputs",async()=>{for(const body of [{action:"status",user_id:"other"},{action:"web_checkout",price:1},{action:"verify_google",token:"fixture",tier:"pro"}]){reset();assert.equal((await billing(request(body))).status,400);assert.equal(calls.length,1);}});
Deno.test("Billing status only reads subscriptions of the authenticated owner",async()=>{reset();assert.equal((await billing(request({action:"status"}))).status,200);assert.ok(calls.find(c=>c.url.includes("/subscriptions?"))?.url.includes(`user_id=eq.${owner}`));assert.equal(eventSeen,false);});
Deno.test("Invalid web signature cannot reconcile or fetch payment data",async()=>{reset();const req=new Request("https://edge.test/billing-webhook?provider=web",{method:"POST",headers:{"content-type":"application/json"},body:'{}'});assert.equal((await webhook(req)).status,401);assert.equal(calls.length,0);});
Deno.test("A valid signed event verifies fresh paid subscription data before reconciliation",async()=>{reset();const req=await signed({data:{id:"evt_fixture",attributes:{type:"subscription.updated",livemode:false,data:subscription()}}});assert.equal((await webhook(req)).status,200);assert.equal(eventSeen,true);const call=calls.find(c=>c.url.includes("reconcile_subscription"))!;assert.equal((call.body as Record<string,unknown>).p_user,owner);assert.equal(((call.body as Record<string,unknown>).p_subscription as Record<string,unknown>).tier,"plus");});
Deno.test("Wrong test/live event mode is denied despite valid HMAC",async()=>{reset();assert.equal((await webhook(await signed({data:{id:"evt_fixture",attributes:{livemode:true,data:subscription()}}}))).status,401);assert.equal(calls.length,0);});
Deno.test("Unmapped signed refund retries instead of being silently ignored",async()=>{reset();assert.equal((await webhook(await signed({data:{id:"evt_fixture_refund",attributes:{type:"refund.updated",livemode:false,data:{id:"ref_fixture",type:"refund",attributes:{payment_id:"pay_fixture",amount:24900,status:"succeeded"}}}}}))).status,503);assert.equal(eventSeen,false);});
Deno.test("An unpaid first invoice never unlocks web access",async()=>{reset();paid=false;assert.equal((await webSubscription("subs_fixture")).subscription.status,"expired");});
Deno.test("A plan change does not upgrade an already paid invoice or extend that paid period",async()=>{reset();const previous=(await webSubscription("subs_fixture")).subscription;plan="plan_fixture_pro";const next=(await webSubscription("subs_fixture",previous)).subscription;assert.equal(next.tier,"plus");assert.equal(next.paid_through,previous.paid_through);invoice="inv_fixture_next";assert.equal((await webSubscription("subs_fixture",previous)).subscription.tier,"pro");});
Deno.test("A delayed paid event cannot revive a revoked invoice",async()=>{reset();const old=(await webSubscription("subs_fixture")).subscription;old.status="revoked";assert.equal((await webSubscription("subs_fixture",old)).subscription.status,"revoked");invoice="inv_fixture_new";assert.equal((await webSubscription("subs_fixture",old)).subscription.status,"active");});
Deno.test("Web configuration checks actual plan price before purchase",async()=>{reset();await checkWebPlan({provider:"web",id:"plan_fixture_plus",tier:"plus",interval:"monthly"});await assert.rejects(()=>checkWebPlan({provider:"web",id:"plan_fixture_plus",tier:"pro",interval:"monthly"}));});
Deno.test("Provider JSON has a streaming size boundary",async()=>{reset();assert.deepEqual(await providerJson("https://fixture.test/provider"),{ok:true});large=true;await assert.rejects(()=>providerJson("https://fixture.test/provider"));});
