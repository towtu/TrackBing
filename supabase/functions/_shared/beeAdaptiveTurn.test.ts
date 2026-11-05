import {expect,it,vi} from 'vitest';
import {adaptiveTurn} from './beeAdaptiveTurn.ts';
import {searchNutrition} from './beeNutrition.ts';
import type {BeeContext} from './beeConversation.ts';
import type {BeeRequest} from './beeTypes.ts';
// Synthetic source fixture values are TEST DATA only.
it.each(['trusted review','accounting failure'])('handles an independent food review safely with %s',async failure=>{
 const query={name:'whole egg',preparation:'boiled',brand:null,variant:null,market:null,packageGrams:null,portion:{amount:72,unit:'g' as const}};
 const result=await searchNutrition(query,{usdaApiKey:'TEST-key',signal:new AbortController().signal,personal:async()=>[],fetch:vi.fn(async()=>Response.json({foods:[{fdcId:123,description:'Egg, whole, cooked, hard-boiled',foodNutrients:[{nutrientId:1008,value:100},{nutrientId:1003,value:10},{nutrientId:1004,value:5},{nutrientId:1005,value:2}]}],products:[]}))},'fallback');
 expect(result.kind).toBe('found');
 const model=vi.fn().mockResolvedValueOnce({reply:'I will check.',nextStep:'lookup_food',suggestedPose:'searching',query}).mockResolvedValueOnce({reply:'Nothing has been logged yet.',suggestedPose:'thinking'});
 if(failure==='accounting failure')model.mockReset().mockRejectedValueOnce(new Error('database_error'));
 const request={requestId:'test',timeZone:'Asia/Manila',command:{kind:'message',text:'72 g boiled whole egg'}} as BeeRequest;
 const context:BeeContext={recent:[],memories:[],profile:{},pending:null,state:{awaiting:'none'}};
 const work=adaptiveTurn(request,context,{localDate:'2026-10-19',totals:{calories:0,protein:0,carbs:0,fat:0,count:0},weights:[],recentLogTimes:[],revision:'0'},'pro',model,async()=>result,new Date('2026-10-19T01:00:00Z'));
 if(failure==='accounting failure'){await expect(work).rejects.toThrow('database_error');return;}
 const outcome=await work;
 expect(model).toHaveBeenCalledTimes(1);
 expect(outcome.draft).toMatchObject({calories:72,grams:72,source:'usda'});
 expect(outcome.text).toContain('Add');expect(outcome.text).not.toContain('logged yet');
});
