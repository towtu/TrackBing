// Real disposable LOCAL Supabase accounts only. No production project is accepted.
// Auth generates a test recovery OTP server-side; this does not verify Gmail/SMTP.
const assert=require('assert/strict');const fs=require('fs');const crypto=require('crypto');const ts=require('typescript');const {execFileSync}=require('child_process');const {createClient}=require('@supabase/supabase-js');
const container=process.env.TRACKBING_LOCAL_KONG_CONTAINER;
if(!container || !/^supabase_kong_trackbing-local-[A-Za-z0-9]+$/.test(container))throw new Error('Set TRACKBING_LOCAL_KONG_CONTAINER to your isolated TrackBing local Kong container.');
const info=JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8'}))[0];
assert.equal(info.NetworkSettings.Ports['8000/tcp'][0].HostIp,'127.0.0.1');
const port=info.NetworkSettings.Ports['8000/tcp'][0].HostPort;const url=`http://127.0.0.1:${port}`;
const authInfo=JSON.parse(execFileSync('docker',['inspect',container.replace('supabase_kong_','supabase_auth_')],{encoding:'utf8'}))[0];
const authEnv=Object.fromEntries(authInfo.Config.Env.map(value=>{const at=value.indexOf('=');return [value.slice(0,at),value.slice(at+1)];}));
assert.ok(authEnv.GOTRUE_JWT_SECRET,'Local JWT configuration unavailable');
function localKey(role){const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');const body=encode({alg:'HS256',typ:'JWT'})+'.'+encode({role,iss:'supabase',aud:'authenticated',exp:Math.floor(Date.now()/1000)+3600});return body+'.'+crypto.createHmac('sha256',authEnv.GOTRUE_JWT_SECRET).update(body).digest('base64url');}
// Short-lived keys are minted only for this disposable HS256 local stack.
// They never leave this process or target a hosted URL.
const anon=localKey('anon'),service=localKey('service_role');
// Compile repository TS in memory; no generated source or extra tooling dependency.
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,filename);
const {createPasswordRecovery}=require('../src/lib/passwordRecovery.ts');
const {readTrackingRows,trackingRange,diaryTotals}=require('../src/lib/trackingData.ts');
const client=key=>createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
const admin=client(service);const owners=[];
async function cleanup(id){
 for(const table of ['food_logs','personal_foods','daily_summaries','user_goals']){const result=await admin.from(table).delete().eq('user_id',id);assert.equal(result.error,null,'Local fixture cleanup failed: '+table);}
 const result=await admin.auth.admin.deleteUser(id);assert.equal(result.error,null,'Local fixture account cleanup failed');
}
(async()=>{
 // Remove only recognizable disposable fixtures left by an interrupted test.
 const stale=await admin.auth.admin.listUsers({page:1,perPage:1000});assert.equal(stale.error,null);
 for(const account of stale.data.users.filter(value=>/^ux-local-[0-9a-f-]{36}@example\.test$/.test(value.email??'')))await cleanup(account.id);
 try{
  for(let index=0;index<2;index++){
   const email=`ux-local-${crypto.randomUUID()}@example.test`;const password='Local-Fixture-Password1!';
   const created=await admin.auth.admin.createUser({email,password,email_confirm:true});assert.equal(created.error,null);owners.push(created.data.user.id);
   const auth=client(anon);const session=await auth.auth.signInWithPassword({email,password});assert.equal(session.error,null);
   const id=created.data.user.id;
   const goal=await auth.from('user_goals').insert({user_id:id,calorie_target:2000,current_weight:72.4,height:170,age:30,gender:'male',activity_level:'1.375',time_zone:'Asia/Manila'});assert.equal(goal.error,null);
   const saved=await auth.from('food_logs').insert({user_id:id,name:`LOCAL TEST DATA owner ${index}`,calories:120,protein:2,carbs:25,fat:1,serving_size:'72',serving_unit:'g',created_at:'2026-09-29T04:00:00Z'});assert.equal(saved.error,null);
   owners[index]={id,email,password,client:auth};
  }
  const range=trackingRange('2026-09-29','2026-09-29','Asia/Manila');
  const a=owners[0],b=owners[1];
  const owned=await readTrackingRows({client:a.client,userId:a.id,isActive:()=>true},'food_logs',range);assert.equal(owned.length,1);assert.equal(owned[0].name,'LOCAL TEST DATA owner 0');assert.equal(diaryTotals(owned).calories,120);
  for(const table of ['food_logs','weight_logs','user_goals','personal_foods','recipes','bee_memories']){
   const denied=await readTrackingRows({client:a.client,userId:b.id,isActive:()=>true},table,range);assert.equal(denied.length,0,table+' cross-owner read');
  }
  const recoveryClient=client(anon);const recovery=createPasswordRecovery(recoveryClient.auth);
  // Controller binding is created by a send request; admin OTP must be generated
  // after it because recovery tokens are single-use and a resend supersedes them.
  const sent=await recovery.send(a.email);assert.equal(sent.ok,true);
  const latest=await admin.auth.admin.generateLink({type:'recovery',email:a.email});assert.equal(latest.error,null);
  assert.ok(/^\d{6}$/.test(latest.data.properties.email_otp),'Local recovery OTP must have six digits');
  assert.equal((await recovery.finish('000000','New-Local-Password2!','New-Local-Password2!')).ok,false);
  const changed=await recovery.finish(latest.data.properties.email_otp,'New-Local-Password2!','New-Local-Password2!');assert.equal(changed.ok,true);
  const fresh=client(anon);assert.equal((await fresh.auth.signInWithPassword({email:a.email,password:a.password})).error!==null,true);
  assert.equal((await fresh.auth.signInWithPassword({email:a.email,password:'New-Local-Password2!'})).error,null);
  recovery.dispose();console.log('Local Auth recovery OTP/password change and six-table cross-owner tracking reads passed. Gmail delivery is not covered.');
 }finally{
  for(const owner of owners){const id=typeof owner==='string'?owner:owner.id;
   // Legacy diary/profile FKs do not cascade. Delete only these disposable owners.
   await cleanup(id);
  }
 }
})().catch(error=>{console.error(error.message);process.exitCode=1;});
