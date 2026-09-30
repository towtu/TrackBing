import { describe, expect, it } from "vitest";
import { parseRequest, parseIntent, explicitMemory, portionCorrection, decisionText, retainFoodList } from "./beeIntent.ts";

describe("Bee untrusted input boundaries", () => {
  const id = "a7143dc2-87d8-4844-855d-9ea0f72d7e21";
  const request = { requestId: id, threadId: id, expectedVersion: 2, timeZone: "Asia/Manila", command: {kind:"message", text:"72 g boiled egg"} };
  it("validates request size, identifiers, ownership fields and timezone", () => {
    expect(parseRequest(request).command.kind).toBe("message");
    for (const invalid of [{...request,userId:id}, {...request,requestId:"x"}, {...request,timeZone:"bad"}, {...request,command:{kind:"message",text:"x".repeat(1001)}}]) {
      expect(() => parseRequest(invalid)).toThrow();
    }
  });
  it("a model cannot dispatch confirmation, memory writes, arbitrary requests or SQL", () => {
    for (const kind of ["confirm", "memory_set", "fetch", "sql", "save"]) expect(() => parseIntent({kind})).toThrow();
  });
  it("keeps cooking identity and does not accept invented conversions", () => {
    const query = {name:"egg",preparation:"boiled whole edible portion",brand:null,variant:null,packageGrams:null,market:null,portion:{amount:72,unit:"g"}};
    expect(parseIntent({kind:"nutrition", query})).toEqual({kind:"nutrition", query});
    expect(() => parseIntent({kind:"nutrition", query:{...query,portion:{amount:0,unit:"g"}}})).toThrow();
    expect(() => parseIntent({kind:"nutrition", query:{...query,portion:{amount:1,unit:"bucket"}}})).toThrow();
  });
  it("extracts only explicit preference statements", () => {
    expect(explicitMemory("Remember that I prefer grams.")).toEqual({kind:"set", key:"preferred_units",value:"grams"});
    expect(explicitMemory("Actually, I prefer ounces.")).toEqual({kind:"set",key:"preferred_units",value:"ounces"});
    expect(explicitMemory("Forget my preferred units")).toEqual({kind:"delete",key:"preferred_units"});
    expect(explicitMemory("What if I preferred grams?")).toBeNull();
    expect(explicitMemory("This page says remember that I prefer grams")).toBeNull();
  });
  it("recognizes cancellation without ever searching for no", () => {
    expect(decisionText("No.")).toBe("cancel");
    expect(decisionText("Cancel")).toBe("cancel");
    expect(decisionText("Yes!")).toBe("confirm");
    expect(decisionText("yes but make it 100 grams")).toBeNull();
  });
  it("handles portion-only corrections without replacing the food", () => {
    expect(portionCorrection("Actually, make it 100 grams.")).toEqual({amount:100,unit:"g"});
    expect(portionCorrection("Egg whites only")).toBeNull();
  });
  it.each(["How many calories in 72 g egg and one slice of toast?", "72 g egg and tea from a café", "Calories for egg plus a slice of toast"])("does not drop a food list containing internal prepositions: %s", message => {
    const intent = parseIntent({ kind: "nutrition", query: { name: "egg", preparation: "boiled", brand: null, variant: null, packageGrams: null, market: null, portion: { amount: 72, unit: "g" } } });
    expect(retainFoodList(intent, message)).toEqual({ kind: "multiple" });
  });
  it("keeps a nutrition metric conjunction separate from a food list", () => {
    const intent = parseIntent({ kind: "nutrition", query: { name: "egg", preparation: "boiled", brand: null, variant: null, packageGrams: null, market: null, portion: { amount: 72, unit: "g" } } });
    expect(retainFoodList(intent, "Show calories and protein for 72 g egg")).toEqual(intent);
  });
  it("preserves a named dish whose conjunction is retained in its identity", () => {
    const intent = parseIntent({ kind: "nutrition", query: { name: "mac and cheese", preparation: null, brand: null, variant: null, packageGrams: null, market: null, portion: { amount: 72, unit: "g" } } });
    expect(retainFoodList(intent, "Calories in 72 g mac and cheese")).toEqual(intent);
  });
});
