// Illustrative TEST DATA, not live nutrition facts. Controlled browser fixture: intercepts every Supabase request; writes never reach a server.
module.exports = async function installBeeUiMock(page) {
  const user = { id: "11111111-1111-4111-8111-111111111111", aud: "authenticated", role: "authenticated", email: "bee-demo@example.test", app_metadata: {}, user_metadata: { full_name: "Demo" }, identities: [], created_at: "2026-09-26T00:00:00Z" };
  await page.addInitScript(({ user }) => {
    const expiry = Math.floor(Date.now() / 1000) + 86400;
    const encode = (value) => btoa(JSON.stringify(value)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
    const session = { access_token: `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: user.id, exp: expiry, aud: "authenticated", role: "authenticated" })}.browser-fixture`, refresh_token: "browser-fixture", expires_at: expiry, expires_in: 86400, token_type: "bearer", user };
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = function(key) {
      return /^sb-.*-auth-token$/.test(key) ? JSON.stringify(session) : original.call(this, key);
    };
    window.__beeOpenedUrls = [];
    window.open = (url) => { window.__beeOpenedUrls.push(String(url)); return null; };
  }, { user });

  const requests = [];
  const completed = new Map();
  const foodLogs=[];
  const entitlement={tier:"pro",remaining:{requests:250,search:50,insights:30,input_tokens:800000,output_tokens:200000},limits:{requests:250,search:50,insights:30,input_tokens:800000,output_tokens:200000},reset_at:"2026-10-27T00:00:00Z"};
  let snapshot = {entitlement, thread: { id: "22222222-2222-4222-8222-222222222222", version: 0 }, messages: [], memories: [{ key: "usual_preparation", value: "I measure rice cooked", updated_at: "2026-09-26T00:00:00Z" }], profile: { preferred_name: "Demo", calorie_target: 2000 }, pending: null };
  let searchCount = 0;
  let chickenContext = false, rawSuggestion = false;
  const message = (role, text, draft) => ({ id: `message-${snapshot.thread.version}-${role}-${snapshot.messages.length}`, role, text, created_at: new Date().toISOString(), ...(draft ? { draft } : {}) });
  const invalidateChicken = () => {if(snapshot.pending)snapshot.pending.status="superseded";snapshot.pending=null;};
  const reviewChicken = (amount) => {
    invalidateChicken();rawSuggestion=false;
    // Deliberately artificial TEST DATA; exercise arithmetic/labels, not live values.
    const basis={grams:100,unit:"g",count:null,milliliters:null,nutrients:{calories:100,protein:10,carbs:2,fat:4}};
    const food={name:"TEST DATA Chicken Breast (Skinless, Raw)",query:{name:"chicken breast",preparation:"raw skinless",brand:null,variant:null,market:null,packageGrams:null,portion:{amount,unit:"g"}},portion:{amount,unit:"g"},grams:amount,servingLabel:`${amount} g`,source:"trackbing_gist",calories:amount,protein:Math.round(amount)/10,carbs:Math.round(amount*.2)/10,fat:Math.round(amount*.4)/10,evidence:{identity:"TEST DATA Chicken Breast (Skinless, Raw)",title:"TrackBing curated foods — TEST DATA",url:"https://gist.githubusercontent.com/towtu/893f53e31444ad9757f5c4fb6a7edf67/raw/foods.json",sourceId:"fixture",record:"independent",license:"operator-provided",retrievedAt:new Date().toISOString(),excerpt:"Controlled illustrative TEST DATA",basis}};
    const draft={id:`33333333-3333-4333-8333-${String(snapshot.thread.version).padStart(12,"0")}`,kind:"food",thread_id:snapshot.thread.id,review_version:snapshot.thread.version,status:"pending",expires_at:"2099-01-01T00:00:00Z",local_date:new Date().toLocaleDateString("en-CA"),time_zone:"Asia/Manila",food};
    snapshot.pending=draft;snapshot.messages.push(message("assistant",`TEST DATA: ${amount} g raw chicken breast: ${amount} kcal, P${food.protein} C${food.carbs} F${food.fat}. Add this to today's food?`,draft));
  };
  const json = (route, body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

  await page.route("**/auth/v1/**", async (route) => {
    requests.push({ path: new URL(route.request().url()).pathname, method: route.request().method() });
    await json(route, user);
  });
  await page.route("**/rest/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    requests.push({ path, method: request.method() });
    const goal = { user_id: user.id, full_name: "Demo", gender: "male", age: 30, height: 170, current_weight: 70, target_weight: 70, activity_level: "1.375", goal_mode: "maintenance", goal_rate:0,profile_revision:0, unit_system: "metric", calorie_target: 2000, protein_grams: 130, carbs_grams: 250, fat_grams: 60 };
    if(path.endsWith("/rpc/account_entitlement")) return json(route,entitlement);
    if(path.endsWith("/weight_logs")) return json(route,[]);
    await json(route,path.endsWith("/rpc/refresh_daily_summary")?{ok:true}:path.endsWith("/food_logs")?foodLogs:path.endsWith("/user_goals")?goal:request.headers().accept?.includes("object")?null:[]);
  });
  await page.route("**/functions/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith("/ai-food")) {
      const body = request.postDataJSON();
      requests.push({ path, method: request.method(), body });
      if (/egg/i.test(body.query) && body.mode !== "web") {
        return json(route, { food: { name: "Egg, whole, cooked, hard-boiled", serving_label: "72 g", serving_grams: 72, kcal: 111.6, protein: 9.06, carbs: 0.8, fat: 7.64, source: "usda", source_detail: "USDA FoodData Central", confidence: "high", requested_portion: { amount: 72, unit: "g" }, evidence: { url: "https://fdc.nal.usda.gov/food-details/173424/nutrients", title: "USDA FoodData Central", identity: "Egg, whole, cooked, hard-boiled", retrievedAt: "2026-09-26T00:00:00Z", excerpt: "Controlled USDA-like browser fixture", record: "independent", basis: { grams: 100, nutrients: { calories: 155, protein: 12.58, carbs: 1.12, fat: 10.61 }, unit: "g", count: null, milliliters: null } } }, alternatives: [] });
      }
      searchCount++;
      const text = "The exact nutrition panel for this flavor and package size could not be verified. Check the label on your package before logging a serving.";
      return json(route, { error: "answer_only", message: "Use your package label or barcode to review a serving.", answer: { text, citations: [{ title: "Manufacturer product page", url: "https://www.rebisco.com.ph/", startIndex: 0, endIndex: text.length }], searchSuggestionsHtml: ['<div><a href="https://www.google.com/search?q=Fudgee+Barr+nutrition+label" target="_blank">Fudgee Barr nutrition label</a></div>'], searchQueryCount: 1 } });
    }
    if(path.endsWith("/billing")) {const action=request.postDataJSON().action;return json(route,action==="status"?{ok:true,entitlement,subscriptions:[]}:{ok:true,products:[],web_enabled:false});}
    if (!path.endsWith("/bee-chat")) return json(route, { ok: false, error: "not_configured" });
    const body = request.postDataJSON();
    const command = body.command;
    requests.push({ path, method: request.method(), body });
    if (completed.has(body.requestId)) {
      const replay = structuredClone(completed.get(body.requestId));
      delete replay.liveAnswer;
      return json(route, { ok: true, snapshot: replay });
    }
    delete snapshot.liveAnswer;
    delete snapshot.saved_log_id;
    if(command.kind === "insight") snapshot.insight={text:"Your recorded diary is ready to review. Choose one useful next step.",suggested_pose:"encouraging",context_revision:"1",expires_at:"2099-01-01T00:00:00Z"};
    if(command.kind === "message" && /72\.4.*kg/i.test(command.text)) {
      snapshot.thread.version++;
      const draft={kind:"weight",id:"33333333-3333-4333-8333-333333333334",thread_id:snapshot.thread.id,review_version:snapshot.thread.version,status:"pending",expires_at:"2099-01-01T00:00:00Z",local_date:"2026-09-27",time_zone:"Asia/Manila",weight:{weightKg:72.4,originalAmount:72.4,unit:"kg",measuredAt:"2026-09-27T00:00:00Z",localDate:"2026-09-27",timeZone:"Asia/Manila",updatesCurrentWeight:true}};
      snapshot.pending=draft;snapshot.messages.push(message("user",command.text),message("assistant","Review this weight check-in. Your nutrition targets stay unchanged.",draft));
    } else if (command.kind === "message") {
      snapshot.thread.version++;
      snapshot.messages.push(message("user", command.text));
      if (/609.*chicken.*breast/i.test(command.text)) {
        chickenContext=true;rawSuggestion=false;invalidateChicken();snapshot.messages.push(message("assistant","Was the chicken breast weighed raw or after cooking?"));
      } else if (chickenContext && /^ra[.!? ]*$/i.test(command.text)) {
        rawSuggestion=true;invalidateChicken();snapshot.messages.push(message("assistant","Did you mean raw chicken breast?"));
      } else if (chickenContext && rawSuggestion && /^yes[.! ]*$/i.test(command.text)) {
        reviewChicken(609);
      } else if (chickenContext && /^raw[.! ]*$/i.test(command.text)) {
        reviewChicken(609);
      } else if (chickenContext && /(?:actually|make it).*100\s*(?:g|grams)/i.test(command.text)) {
        reviewChicken(100);
      } else if (/^(no|cancel)[.! ]*$/i.test(command.text)) {
        invalidateChicken();rawSuggestion=false;chickenContext=false;snapshot.messages.push(message("assistant","Cancelled. Nothing was saved."));
      } else if (/^yes\b/i.test(command.text) && !snapshot.pending) {
        snapshot.messages.push(message("assistant", "There isn't a reviewed food ready to add. Scan a barcode or enter your package label to review a serving."));
      } else if (/egg/i.test(command.text)) {
        const draft = {
          id: "33333333-3333-4333-8333-333333333333", thread_id: snapshot.thread.id, review_version: 1, status: "pending",
          local_date: new Date().toLocaleDateString("en-CA"), time_zone: "Asia/Manila", expires_at: "2099-09-26T00:00:00Z",
          food: { name: "Egg, whole, cooked, hard-boiled", query: { name: "egg", preparation: "boiled", brand: null, variant: null, packageGrams: null, market: null, portion: { amount: 72, unit: "g" } }, portion: { amount: 72, unit: "g" }, grams: 72, servingLabel: "72 g", calories: 111.6, protein: 9.06, carbs: 0.8, fat: 7.64, source: "usda",
            evidence: { url: "https://fdc.nal.usda.gov/food-details/173424/nutrients", title: "USDA FoodData Central", identity: "Egg, whole, cooked, hard-boiled", retrievedAt: "2026-09-26T00:00:00Z", excerpt: "Controlled USDA-like browser fixture", record: "independent", basis: { grams: 100, nutrients: { calories: 155, protein: 12.58, carbs: 1.12, fat: 10.61 }, unit: "g", count: null, milliliters: null } } },
        };
        snapshot.pending = draft;
        snapshot.messages.push(message("assistant", "Nutrition from a matched boiled egg record. Add 72 g to today's food?", draft));
      } else {
        searchCount++;
        snapshot.pending = null;
        const text = "The exact nutrition panel for this flavor and package size could not be verified. Check the label on your package before logging a serving.";
        snapshot.liveAnswer = { text, citations: [{ title: "Manufacturer product page", url: "https://www.rebisco.com.ph/", startIndex: 0, endIndex: text.length }], searchSuggestionsHtml: ['<style>.container{font-family:Arial,sans-serif;padding:12px;background:#fff;border-radius:8px;color:#202124}.chip{display:inline-block;padding:12px;margin-top:8px;border:1px solid #dadce0;border-radius:18px;color:#1a73e8;text-decoration:none}</style><div class="container"><span>Google</span><br><a class="chip" href="https://www.google.com/search?q=Fudgee+Barr+nutrition+label" target="_blank">Fudgee Barr nutrition label</a></div>'], searchQueryCount: 1 };
        snapshot.messages.push(message("assistant", "I showed a live search answer. Search again to refresh it, or use a barcode or package label to add food."));
      }
    } else if (command.kind === "confirm") {
      if (!snapshot.pending || snapshot.pending.id !== command.actionId || snapshot.pending.review_version !== command.reviewVersion) return json(route, { ok: false, error: "stale_action" });
      snapshot.thread.version++;
      if(snapshot.pending.kind==="weight") {snapshot.pending.status="confirmed";snapshot.saved_action={kind:"weight",id:"fixture-weight-log",pending_id:snapshot.pending.id,local_date:"2026-09-27"};snapshot.pending=null;snapshot.messages.push(message("assistant","Weight check-in saved."));completed.set(body.requestId,structuredClone(snapshot));return json(route,{ok:true,snapshot});}
      foodLogs.push({id:"44444444-4444-4444-8444-444444444444",name:snapshot.pending.food.name,calories:snapshot.pending.food.calories,protein:snapshot.pending.food.protein,carbs:snapshot.pending.food.carbs,fat:snapshot.pending.food.fat,serving_size:String(snapshot.pending.food.portion.amount),serving_unit:snapshot.pending.food.portion.unit,created_at:new Date().toISOString(),user_id:user.id});
      snapshot.pending.status = "confirmed";
      snapshot.pending = null;
      snapshot.saved_log_id = "44444444-4444-4444-8444-444444444444";
      snapshot.messages.push(message("assistant", "Added that reviewed serving to today's food log."));
    } else if (command.kind === "cancel") {
      snapshot.thread.version++;
      if (snapshot.pending) snapshot.pending.status = "cancelled";
      snapshot.pending = null;
      snapshot.messages.push(message("assistant", "Cancelled. No food was added."));
    } else if (command.kind === "clear_chat" || command.kind === "new_thread") {
      snapshot.thread.version++;
      snapshot.messages = [];
      snapshot.pending = null;
    } else if (command.kind === "memory_clear") {
      snapshot.thread.version++;
      snapshot.memories = [];
    } else if (command.kind === "memory_delete") {
      snapshot.thread.version++;
      snapshot.memories = snapshot.memories.filter((memory) => memory.key !== command.key);
    } else if (command.kind === "memory_set") {
      snapshot.thread.version++;
      snapshot.memories = snapshot.memories.filter((memory) => memory.key !== command.key);
      snapshot.memories.push({ key: command.key, value: command.value, updated_at: new Date().toISOString() });
    }
    snapshot.messages = snapshot.messages.slice(-50);
    completed.set(body.requestId, structuredClone(snapshot));
    await json(route, { ok: true, snapshot });
  });
  page.__beeUiMock = { requests, getSnapshot: () => structuredClone(snapshot), getSearchCount: () => searchCount };
  return page.__beeUiMock;
};
