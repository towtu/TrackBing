import React, { useState } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import type { CompleteNutrients, PendingCreation, ReviewedFood } from "../../../supabase/functions/_shared/beeTypes";
import { getBeeSourceUrl } from "@/src/lib/beeChat";
import { Colors } from "@/src/styles/colors";
import { BeeAction } from "./BeeMemories";

const number=(n:number)=>String(Number(n.toFixed(1)));
function Nutrition({value,divisor=1}:{value:CompleteNutrients;divisor?:number}) {
  return <View style={s.nutrition}><Text style={s.calories}>{Math.round(value.calories/divisor)} kcal</Text><Text style={s.text}>Protein {number(value.protein/divisor)} g · Carbohydrates {number(value.carbs/divisor)} g · Fat {number(value.fat/divisor)} g</Text></View>;
}
function Source({food}:{food:ReviewedFood}) {
  const [failed,setFailed]=useState(false);
  const url=getBeeSourceUrl(food.evidence.url);
  const open=async()=>{if(!url)return;try{await Linking.openURL(url);setFailed(false);}catch{setFailed(true);}};
  return <View>{url ? <BeeAction label={food.evidence.title} accessibilityLabel={`Open nutrition source for ${food.name}`} role="link" onPress={()=>void open()}/> : <Text style={s.secondary}>{food.evidence.title}</Text>}{food.evidence.attribution ? <Text style={s.secondary}>{food.evidence.attribution}{food.evidence.license ? ` · ${food.evidence.license}` : ""}</Text> : null}{failed ? <Text accessibilityLiveRegion="polite" style={s.secondary}>Couldn’t open the source. Try again.</Text> : null}</View>;
}
export function BeeCreationReview({draft,current,busy,onConfirm,onEdit,onCancel}:{draft:PendingCreation;current:boolean;busy:boolean;onConfirm:()=>void;onEdit:()=>void;onCancel:()=>void}) {
  const c=draft.creation;
  const destination=c.kind==="recipe" ? "Cookbook" : "My Foods";
  return <View style={s.review} testID="bee-library-review">
    <Text accessibilityRole="header" style={s.title}>{c.name}</Text>
    {c.kind==="recipe" ? <>
      <Text style={s.secondary}>Makes {c.servings} {c.servings===1 ? "serving" : "servings"} · Nutrition per serving</Text>
      <Nutrition value={c.totals} divisor={c.servings}/>
      <Text style={s.heading}>Ingredients</Text>
      {c.foods.map((food,index)=><View key={index} style={s.ingredient}><Text style={s.text}>{food.servingLabel} · {food.name}</Text><Source food={food}/></View>)}
      <Text style={s.heading}>Cooking steps</Text>
      {c.instructions.map((step,index)=><Text key={index} style={s.text}>{index+1}. {step}</Text>)}
      <Text style={s.secondary}>Calculated from ingredient records, not a measured cooked-food label. Cooking can change water weight.</Text>
    </> : <>
      <Text style={s.secondary}>{c.defaultUnit==="serving" ? "Nutrition per 1 serving" : `Nutrition per 100 ${c.defaultUnit}`}</Text>
      <Nutrition value={c.nutrients}/>
      {c.defaultUnit==="serving" ? <Text style={s.secondary}>A saved serving uses one {c.food.portion.unit} from this record. No gram conversion is assumed.</Text> : null}
      <Source food={c.food}/>
    </>}
    <Text style={s.secondary}>Saves to {destination}. This does not record what you ate.</Text>
    {current ? <><BeeAction label={`Save to ${destination}`} primary disabled={busy} onPress={onConfirm}/><View style={s.actions}><BeeAction label={c.kind==="recipe" ? "Edit recipe" : "Edit food"} disabled={busy} onPress={onEdit}/><BeeAction label="Cancel" accessibilityLabel={`Cancel creation of ${c.name}`} disabled={busy} onPress={onCancel}/></View></> : <Text style={s.secondary}>{draft.status==="confirmed" ? `Saved to ${destination}` : draft.status==="pending" ? "Review expired or replaced — use the latest review." : draft.status}</Text>}
  </View>;
}
const s=StyleSheet.create({review:{gap:10,borderTopWidth:1,borderTopColor:Colors.border,paddingTop:12,marginTop:10},title:{color:Colors.text,fontSize:18,fontWeight:"700"},heading:{color:Colors.text,fontSize:14,fontWeight:"700",marginTop:6},text:{color:Colors.text,fontSize:14,lineHeight:21},secondary:{color:Colors.textSecondary,fontSize:12,lineHeight:18},calories:{color:Colors.accent,fontWeight:"700",fontSize:24},nutrition:{gap:6},ingredient:{gap:2,paddingBottom:8,borderBottomWidth:1,borderBottomColor:Colors.border},actions:{flexDirection:"row",flexWrap:"wrap",gap:8}});
