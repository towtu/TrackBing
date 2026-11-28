import {lookupUSDABarcode,searchUSDA} from './usda';
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

describe('USDA barcode nutrition', () => {
  const barcode = '012345678905';
  const fixture = {fdcId:1,description:'TEST DATA exact product',dataType:'Branded',gtinUpc:'00012345678905',servingSize:35,servingSizeUnit:'GRM',foodNutrients:nutrients};
  beforeEach(() => invoke.mockReset());

  it('uses an exact GTIN with zero padding and preserves its label basis', async () => {
    invoke.mockResolvedValue({data:{foods:[{...fixture,gtinUpc:'012345678912'},fixture]}});
    await expect(lookupUSDABarcode(barcode)).resolves.toMatchObject({ok:true,hasNutrition:true,food:{code:barcode,product_name:fixture.description,default_unit:'g',serving_weight:35,nutriments:{'energy-kcal_100g':100,proteins_100g:0}}});
    expect(invoke).toHaveBeenCalledWith('usda-search',{body:{query:'00012345678905',dataType:['Branded'],pageSize:10},timeout:3000});
  });

  it('keeps a 100 mL basis separate from weight', async () => {
    invoke.mockResolvedValue({data:{foods:[{...fixture,servingSize:41,servingSizeUnit:'MLT'}]}});
    await expect(lookupUSDABarcode(barcode)).resolves.toMatchObject({ok:true,food:{default_unit:'ml',serving_weight:41}});
  });

  it('does not use fuzzy hits, missing macros, unspecified bases or conflicting matches', async () => {
    invoke.mockResolvedValueOnce({data:{foods:[{...fixture,gtinUpc:'012345678912'},{...fixture,servingSizeUnit:undefined},{...fixture,foodNutrients:nutrients.filter(n=>n.nutrientId!==1004)}]}});
    await expect(lookupUSDABarcode(barcode)).resolves.toEqual({ok:false,reason:'not-found'});
    invoke.mockResolvedValueOnce({data:{foods:[fixture,{...fixture,fdcId:2,foodNutrients:[{nutrientId:1008,value:200},...nutrients.slice(1)]}]}});
    await expect(lookupUSDABarcode(barcode)).resolves.toEqual({ok:false,reason:'not-found'});
  });

  it('does not send private/non-GTIN codes to the fallback', async () => {
    await expect(lookupUSDABarcode('12345')).resolves.toEqual({ok:false,reason:'not-found'});
    await expect(lookupUSDABarcode('012345678907')).resolves.toEqual({ok:false,reason:'not-found'});
    expect(invoke).not.toHaveBeenCalled();
  });

  it('leaves eight-digit codes with ambiguous symbology to Open Food Facts', async () => {
    await expect(lookupUSDABarcode('01234565')).resolves.toEqual({ok:false,reason:'not-found'});
    expect(invoke).not.toHaveBeenCalled();
  });
});
