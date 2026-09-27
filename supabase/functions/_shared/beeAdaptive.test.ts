import { describe, expect, it } from "vitest";
import { parseBeeDecision, parseBeeReply, weightTrend, makeWeightDraft, makeGoalDraft } from "./beeAdaptive.ts";

const now = new Date("2026-09-27T02:00:00Z");
const profile = {age:30,gender:"male",current_weight:72.4,height:175,activity_level:"1.375",goal_mode:"estimated_rate",goal_rate:-0.005,calorie_target:1800,protein_grams:112,carbs_grams:202,fat_grams:60,protein_ratio:25,carbs_ratio:45,fat_ratio:30,target_weight:68,profile_revision:4};
describe("adaptive Bee read decisions", () => {
  it("allows bounded read-only decisions and an approved pose",()=>{
    expect(parseBeeDecision({reply:"Let me check your recorded week.",nextStep:"read_data",requestedReads:["weight_history","current_goal"],suggestedPose:"thinking"})).toMatchObject({nextStep:"read_data",requestedReads:["weight_history","current_goal"]});
  });
  it.each([
    {reply:"Saved",nextStep:"save_weight",suggestedPose:"success"},
    {reply:"Checking",nextStep:"read_data",requestedReads:["other_user"],suggestedPose:"thinking"},
    {reply:"Checking",nextStep:"answer",suggestedPose:"angry"},
    {reply:"Checking",nextStep:"answer",suggestedPose:"thinking",sql:"update goals"},
  ])("rejects writes, private cross-owner tools and unknown fields",value=>expect(()=>parseBeeDecision(value)).toThrow());
  it("rejects fabricated save claims in generated replies",()=>expect(()=>parseBeeReply({reply:"I saved your weight.",suggestedPose:"success"})).toThrow());
  it("accepts a fresh concise reply without granting action authority",()=>expect(parseBeeReply({reply:"One recorded weigh-in cannot establish a trend.",suggestedPose:"encouraging"})).toEqual({reply:"One recorded weigh-in cannot establish a trend.",suggestedPose:"encouraging"}));
});
describe("recorded weight and exact reviews",()=>{
  it("one measurement provides no trend",()=>expect(weightTrend([{weight_kg:72.4,measured_at:"2026-09-27T01:00:00Z"}])).toBeNull());
  it("two dated actual measurements calculate their difference",()=>expect(weightTrend([{weight_kg:72.4,measured_at:"2026-09-27T01:00:00Z"},{weight_kg:73.2,measured_at:"2026-09-20T01:00:00Z"}])).toMatchObject({changeKg:-0.8,measurementCount:2,elapsedDays:7}));
  it("same-day measurements do not imply a reliable trend",()=>expect(weightTrend([{weight_kg:72.4,measured_at:"2026-09-27T01:00:00Z"},{weight_kg:73.2,measured_at:"2026-09-27T02:00:00Z"}])).toBeNull());
  it("converts an explicit lb correction using the current pending date",()=>{
    const original=makeWeightDraft("My weight today is 72.4 kg",now,"Asia/Manila",[]);
    const corrected=makeWeightDraft("I meant 160 lb",now,"Asia/Manila",[],original);
    expect(corrected?.weightKg).toBeCloseTo(72.5747792);expect(corrected?.localDate).toBe(original?.localDate);expect(corrected?.originalAmount).toBe(160);expect(corrected?.unit).toBe("lb");
  });
  it("backdated check-in cannot overwrite a later current weight",()=>expect(makeWeightDraft("I weighed 72.4 kg yesterday",now,"Asia/Manila",[{weight_kg:73,measured_at:"2026-09-27T01:00:00Z"}])?.updatesCurrentWeight).toBe(false));
  it.each(["My weight is 72.4", "I ate 72.4 g egg", "My weight is 5 kg", "My weight is 72.4 kg on 2030-01-01"])("asks rather than guessing or clamping %s",value=>expect(makeWeightDraft(value,now,"Asia/Manila",[])).toBeNull());
});
describe("server calculated goal reviews",()=>{
  it("reuses the existing target rules and actual goal_rate column",()=>{
    const draft=makeGoalDraft(profile,"Review my calorie goal");expect(draft.kind).toBe("review");if(draft.kind!=="review")return;
    expect(draft.goal.profileRevision).toBe(4);expect(draft.goal.next.goal_rate).toBe(-0.005);expect(draft.goal.next.calorie_target).toBeGreaterThan(1500);expect(draft.goal.next.target_weight).toBe(68);expect(draft.goal.previous.calorie_target).toBe(1800);
  });
  it("asks when a custom legacy target has no chosen calculation policy",()=>expect(makeGoalDraft({...profile,goal_mode:"legacy_custom",goal_rate:null},"Review my calorie goal").kind).toBe("clarify"));
  it("retains minor maintenance safeguards in the shared calculator",()=>{
    const draft=makeGoalDraft({...profile,age:16,goal_mode:"minor_maintenance",goal_rate:null},"Review my goal");expect(draft.kind).toBe("review");if(draft.kind!=="review")return;
    expect(draft.goal.next.goal_mode).toBe("minor_maintenance");expect(draft.goal.next.goal_rate).toBeNull();expect(draft.goal.next.calculation_method).toBe("nasem_eer_2023");
  });
  it("asks for missing profile facts rather than substituting model defaults",()=>expect(makeGoalDraft({...profile,height:null},"Review my goal").kind).toBe("clarify"));
});

// Portion values below are explicitly supplied test inputs, not nutrition evidence.
import { retainFoodList } from "./beeIntent";
it("retains an explicit 72 g portion even if the model chooses 100 g", () => {
 const query = {name:"egg",preparation:"boiled",brand:null,variant:null,packageGrams:null,market:null,portion:{amount:100,unit:"g" as const}};
 const result=retainFoodList({kind:"nutrition",query},"How many calories in 72 grams of boiled egg?");
 expect(result.kind).toBe("nutrition"); if(result.kind==="nutrition")expect(result.query.portion).toEqual({amount:72,unit:"g"});
});
