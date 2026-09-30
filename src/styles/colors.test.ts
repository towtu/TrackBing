import { describe, expect, it } from "vitest";
import { Colors } from "./colors";
const luminance=(hex:string)=>{
  const rgb=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4);
  return rgb[0]*0.2126+rgb[1]*0.7152+rgb[2]*0.0722;
};
const ratio=(a:string,b:string)=>(Math.max(luminance(a),luminance(b))+0.05)/(Math.min(luminance(a),luminance(b))+0.05);
describe("TrackBing readable palette",()=>{
  for(const bg of [Colors.primary,Colors.secondary,Colors.surface,Colors.surfaceHover]) {
    it.each(["text","textSecondary","textMuted","error","success","protein","carbs","fat","accentBlue"] as const)("%s text meets4.5 on "+bg,key=>expect(ratio(Colors[key],bg)).toBeGreaterThanOrEqual(4.5));
  }
  it("accent button text and keyboard focus are visible",()=>{
    expect(ratio(Colors.textOnAccent,Colors.accent)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(Colors.accent,Colors.surface)).toBeGreaterThanOrEqual(3);
  });
});
