import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { exportCsv, readTrackingRows, trackingRange, createTrackingExport } from './trackingData';

function reader(pages: unknown[][], failure = false) {
  const calls: {method:string;args:unknown[]}[] = [];
  const query: Record<string, unknown> = {};
  for (const method of ['select','eq','gte','lt','lte','gt','order','limit','abortSignal']) query[method]=(...args:unknown[])=>{calls.push({method,args});return query;};
  query.then=(resolve:(value:unknown)=>unknown)=>Promise.resolve({data:pages.shift() ?? [],error:failure ? {message:'internal-secret'} : null}).then(resolve);
  const client={from:vi.fn((_table:string)=>query)} as unknown as SupabaseClient;
  return {client,calls};
}
describe('private diary and tracking exports', () => {
  it('uses inclusive local start and exclusive next day across Manila midnight and DST', () => {
    expect(trackingRange('2026-09-30','2026-09-30','Asia/Manila')).toMatchObject({start:'2026-09-29T16:00:00.000Z',end:'2026-09-30T16:00:00.000Z'});
    const spring=trackingRange('2026-03-08','2026-03-08','America/New_York');
    expect((Date.parse(spring.end)-Date.parse(spring.start))/3600000).toBe(23);
    const fall=trackingRange('2026-11-01','2026-11-01','America/New_York');
    expect((Date.parse(fall.end)-Date.parse(fall.start))/3600000).toBe(25);
  });
  it.each([['2026-02-30','2026-03-01'],['2026-10-01','2026-09-30'],['2025-01-01','2026-09-30'],['garbage','2026-09-30']])('rejects invalid or excessive range %s to %s',(from,to)=>{
    expect(()=>trackingRange(from,to,'Asia/Manila')).toThrow();
  });
  it('requires a valid timezone',()=>expect(()=>trackingRange('2026-09-30','2026-09-30','guess')).toThrow());
  it('scopes every page to the pinned owner and continues even after a short server page',async()=>{
    const {client,calls}=reader([[{id:'a',name:'TEST DATA food'}],[{id:'b',name:'TEST DATA food two'}],[]]);
    const rows=await readTrackingRows({client,userId:'owner',isActive:()=>true},'food_logs',trackingRange('2026-09-30','2026-09-30','Asia/Manila'));
    expect(rows).toHaveLength(2);
    expect(calls.filter(c=>c.method==='eq')).toEqual(Array(3).fill({method:'eq',args:['user_id','owner']}));
    expect(calls.filter(c=>c.method==='gt')).toEqual([{method:'gt',args:['id','a']},{method:'gt',args:['id','b']}]);
    expect(calls.filter(c=>c.method==='lt')[0].args).toEqual(['created_at','2026-09-30T16:00:00.000Z']);
    expect(calls.find(c=>c.method==='select')?.args[0]).not.toContain('user_id');
  });
  it('fails rather than silently truncating a diary/export',async()=>{
    const {client}=reader([[{id:'a'},{id:'b'}]]);
    await expect(readTrackingRows({client,userId:'owner',isActive:()=>true},'food_logs',undefined,{maxRows:1})).rejects.toThrow('smaller');
  });
  it('does not return data after account switch or database failure',async()=>{
    const {client}=reader([[{id:'a'}]]); let checks=0;
    await expect(readTrackingRows({client,userId:'owner',isActive:()=>++checks<2},'food_logs')).rejects.toThrow('account');
    const failed=reader([],true);
    await expect(readTrackingRows({client:failed.client,userId:'owner',isActive:()=>true},'food_logs')).rejects.toThrow('load');
  });
  it('escapes quotes/newlines and neutralizes spreadsheet formulas in text fields',()=>{
    const csv=exportCsv([{id:'a',name:'=HYPERLINK("bad")',calories:120,protein:2,carbs:3,fat:4,created_at:'2026-09-30T00:00:00Z',serving_size:'72',serving_unit:'g',ai_estimated:false},{id:'b',name:'Rice,\n"cooked"',calories:null,protein:null,carbs:null,fat:null}], 'food_logs');
    expect(csv).toContain('"\'=HYPERLINK(""bad"")"');
    expect(csv).toContain('"Rice,\n""cooked"""');
    expect(csv).not.toContain('null');
    for (const name of ['+cmd','-cmd','@cmd','\t=cmd','  =cmd']) expect(exportCsv([{name}], 'food_logs')).toContain("'");
  });
  it('formats a portable JSON export with allowed tracking fields only',()=>{
    const result=createTrackingExport({food_logs:[{id:'a',name:'TEST DATA',calories:20,password:'never'}],weight_logs:[],user_goals:[{current_weight:72,secret:'never'}],personal_foods:[],recipes:[],bee_memories:[]},trackingRange('2026-09-30','2026-09-30','Asia/Manila'),new Date('2026-09-30T00:00:00Z'));
    expect(result).not.toContain('never');
    expect(JSON.parse(result).range.timeZone).toBe('Asia/Manila');
    expect(JSON.parse(result).food_logs[0]).toEqual({id:'a',name:'TEST DATA',calories:20});
  });
});
