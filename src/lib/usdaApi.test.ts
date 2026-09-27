import {searchUSDA} from './usda';
import {beforeEach,describe,expect,it,vi} from "vitest";
const {invoke}=vi.hoisted(()=>({invoke:vi.fn()}));
vi.mock('./supabase',()=>({supabase:{functions:{invoke}}}));
// Illustrative TEST DATA for source validation, not a measured egg's nutrition.
const nutrients=[{nutrientId:1008,value:100},{nutrientId:1003,value:0},{nutrientId:1005,value:2},{nutrientId:1004,value:3}];
describe('USDA manual search validation',()=>{
 beforeEach(()=>invoke.mockReset());
 it('retains explicit zero macros and preparation from an authenticated source response',async()=>{invoke.mockResolvedValue({data:{foods:[{fdcId:1,description:'Fixture whole egg, boiled',foodNutrients:nutrients}]}});const result=await searchUSDA('boiled egg');expect(result[0].product_name).toContain('boiled');expect(result[0].nutriments.proteins_100g).toBe(0);expect(invoke).toHaveBeenCalledWith('usda-search',{body:{query:'boiled egg',pageSize:50}});});
 it('does not manufacture missing or negative macros as zero',async()=>{invoke.mockResolvedValue({data:{foods:[{fdcId:1,description:'Fixture missing protein',foodNutrients:nutrients.filter(n=>n.nutrientId!==1003)},{fdcId:2,description:'Fixture invalid fat',foodNutrients:[...nutrients.filter(n=>n.nutrientId!==1004),{nutrientId:1004,value:-1}]}]}});expect(await searchUSDA('egg')).toEqual([]);});
 it('converts stated per-100 kJ once and keeps calorie zero when explicitly stated',async()=>{invoke.mockResolvedValue({data:{foods:[{fdcId:1,description:'Fixture kJ',foodNutrients:[...nutrients.filter(n=>n.nutrientId!==1008),{nutrientId:1062,value:418.4}]}]}});expect((await searchUSDA('fixture'))[0].nutriments['energy-kcal_100g']).toBeCloseTo(100,10);});
});
