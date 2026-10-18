import { describe, expect, it } from 'vitest';
import { deterministicTurn, type BeeContext } from './beeConversation.ts';
import type { BeeRequest, FoodQuery } from './beeTypes.ts';
const query: FoodQuery = {name:'chicken breast',preparation:'grilled skinless',brand:null,variant:null,market:null,packageGrams:null,portion:{amount:609,unit:'g'}};
const context: BeeContext = {state:{awaiting:'clarification',query},pending:null,memories:[],profile:{},recent:[]};
const request = (text:string):BeeRequest => ({requestId:'test',threadId:'test',expectedVersion:1,timeZone:'Asia/Manila',command:{kind:'message',text}});
describe('preparation follow-ups retain food identity', () => {
  it('raw keeps chicken, skin and exact grams while requiring a fresh lookup', () => {
    const result = deterministicTurn(request('raw'),context);
    expect(result).toMatchObject({lookup_query:{...query,preparation:'raw skinless'},invalidate_pending:true});
    expect(result?.confirm).toBeUndefined();
  });
  it('ra asks a question; yes resolves that question without confirming food', () => {
    const question = deterministicTurn(request('ra'),context)!;
    expect(question.text).toContain('raw');
    expect(question.state?.query).toEqual(query);
    expect(question.lookup_query).toBeUndefined();
    const answer = deterministicTurn(request('yes'), {...context,state:question.state!});
    expect(answer?.lookup_query).toMatchObject({name:'chicken breast',preparation:'raw skinless',portion:query.portion});
    expect(answer?.confirm).toBeUndefined();
  });
  it('an incomplete preparation without a food asks which food instead of searching ra', () => {
    expect(deterministicTurn(request('ra'),{...context,state:{}})?.text).toContain('food');
  });
  it('new foods and arbitrary short words are not rewritten as preparation', () => {
    expect(deterministicTurn(request('Cobra energy drink'),context)).toBeNull();
    expect(deterministicTurn(request('rice'),context)).toBeNull();
  });
});
it('preparation inside a previous food name is replaced rather than contradicted',()=>{
 const result=deterministicTurn(request('raw'),{...context,state:{awaiting:'review',query:{...query,name:'Grilled chicken breast',preparation:'skinless'}}});
 expect(result?.lookup_query).toMatchObject({name:'chicken breast',preparation:'raw skinless',portion:query.portion});
});
it('a skin-only follow-up keeps the established cooking state',()=>{
 const result=deterministicTurn(request('skinless'),{...context,state:{awaiting:'clarification',query:{...query,preparation:'raw'}}});
 expect(result?.lookup_query).toMatchObject({name:'chicken breast',preparation:'raw skinless',portion:query.portion});
});
