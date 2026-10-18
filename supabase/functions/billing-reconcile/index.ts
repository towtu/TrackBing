import {createClient} from "jsr:@supabase/supabase-js@2";
import {env,verifyApplePurchase,verifyGooglePurchase,webSubscription} from "../_shared/billingProviders.ts";
import {billingStore} from "../_shared/billingStore.ts";
// Scheduler-only credential, independent of application sessions. No supplied user or SQL.
Deno.serve(async(req:Request)=>{
 const response=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
 if(req.method!=="POST")return response(405,{ok:false});
 const expected=env("BILLING_RECONCILE_SECRET"), supplied=req.headers.get("authorization")??"";
 if(expected.length<32)return response(503,{ok:false});
 const a=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(`Bearer ${expected}`))),b=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(supplied)));let difference=0;for(let i=0;i<a.length;i++)difference|=a[i]^b[i];
 if(difference!==0||supplied.length>256)return response(401,{ok:false});
 if(!env("SUPABASE_URL")||!env("SUPABASE_SERVICE_ROLE_KEY"))return response(503,{ok:false});
 const admin=createClient(env("SUPABASE_URL"),env("SUPABASE_SERVICE_ROLE_KEY"),{auth:{persistSession:false}}),store=billingStore(admin);
 const {data,error}=await admin.from("subscriptions").select("*").neq("provider","legacy").lt("updated_at",new Date(Date.now()-15*60000).toISOString()).order("updated_at").limit(3);
 if(error)return response(503,{ok:false});
 let failures=0;
 await Promise.all((data??[]).map(async(row)=>{try{
  let subscription;
  if(row.provider==="web")subscription=(await webSubscription(row.external_id,row)).subscription;
  else if(row.provider==="apple")subscription=await verifyApplePurchase(row.external_id,row.user_id);
  else {const {data:credential,error}=await admin.from("billing_purchase_credentials").select("purchase_token").eq("provider","google").eq("external_id",row.external_id).eq("user_id",row.user_id).single();if(error||!credential)throw new Error("missing_receipt");subscription=(await verifyGooglePurchase(credential.purchase_token,row.user_id)).subscription;}
  await store.reconcile(row.provider,crypto.randomUUID(),new Date().toISOString(),row.user_id,subscription);
 }catch{failures++;console.error("billing_reconciliation_failed",{provider:row.provider});}}));
 return response(failures?503:200,{ok:failures===0,checked:data?.length??0,failed:failures});
});
