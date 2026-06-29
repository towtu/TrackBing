# TrackBing Pro — AI Macro Assistant Implementation Plan (Plan A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user describe a food/meal in natural language (or tap "AI fill" on the create-food form), get DeepSeek-estimated structured macros, review/edit them, and save to My Foods and/or log them — gated by a server-enforced free quota.

**Architecture:** A Supabase Edge Function (`ai-food`) holds the DeepSeek key, authenticates the user, enforces quota, calls DeepSeek with a strict JSON schema, and validates/normalizes the result server-side. Pure logic (macro validation, quota/period math) lives in `supabase/functions/_shared/` so it is unit-testable with vitest and reused by the Deno function. The client calls the function via `supabase.functions.invoke`, shows a review sheet, and persists to `personal_foods`/`food_logs` with an `ai_estimated` flag.

**Tech Stack:** Expo/React Native + TypeScript, Supabase (Postgres + Edge Functions/Deno), DeepSeek API (OpenAI-compatible), vitest.

## Global Constraints

- DeepSeek + any secret keys live **only** in Edge Function env (`Deno.env`); never in the client bundle or `EXPO_PUBLIC_*`. (spec §6)
- Every new table has **RLS enabled, owner-only** (`auth.uid() = user_id`), matching `supabase/migrations/20260624000000_enable_rls_user_tables.sql`. (spec §5)
- Quota + entitlement are enforced **server-side in `ai-food`**; the UI gate is not access control. (spec §4.1, §6)
- AI output is treated as **data only** — never `dangerouslySetInnerHTML`, never executed. (spec §6)
- Macro sanity: `4·protein + 4·carbs + 9·fat` within tolerance of `kcal`; no negatives; plausible caps. (spec §3.3)
- TypeScript strict, no `any` unless justified in a comment. Commits authored by towtu, **no AI co-author trailers**. (AGENTS.md)
- Tunable defaults: free quota **7/month**; Pro cap **100/day**; model **`deepseek-chat`** with JSON output. (spec §2)
- Migrations are applied manually via the Supabase SQL editor (no CLI); add `notify pgrst, 'reload schema';` when creating RPC/functions. (memory: supabase-migrations-applied)

---

## File Structure

**Create:**
- `supabase/migrations/20260629000000_add_ai_and_entitlements.sql` — `ai_estimated` columns + `entitlements` + `ai_usage` tables with RLS.
- `supabase/functions/_shared/macros.ts` — pure validate/normalize of a raw DeepSeek food (vitest-tested).
- `supabase/functions/_shared/quota.ts` — pure period/quota/entitlement helpers (vitest-tested).
- `supabase/functions/_shared/macros.test.ts`, `supabase/functions/_shared/quota.test.ts` — vitest tests.
- `supabase/functions/ai-food/index.ts` — Deno edge function (auth → quota → DeepSeek → validate → usage++).
- `src/lib/aiFood.ts` — client types + `requestAiFood()` wrapper over `supabase.functions.invoke`.
- `src/components/ai/AiFoodSheet.tsx` — review/edit sheet with the "AI estimate" badge.
- `src/components/ai/AiEstimateBadge.tsx` — the reusable badge.
- `src/components/ai/UpgradePrompt.tsx` — shown when quota is exhausted (placeholder CTA until Plan B).

**Modify:**
- `vitest.config` / `package.json` test glob — ensure `supabase/functions/**/*.test.ts` is picked up.
- The Find Food screen (AI ask-box entry point) — confirm exact path during Task 6.
- The create-food form (AI-fill button) — confirm exact path during Task 6.
- `src/lib/foodSearch.ts` types / persistence so saved AI foods set `ai_estimated`.

---

## Task 1: Data layer — `ai_estimated`, `entitlements`, `ai_usage`

**Files:**
- Create: `supabase/migrations/20260629000000_add_ai_and_entitlements.sql`

**Interfaces:**
- Produces: tables `entitlements(user_id uuid pk, pro_until timestamptz)`, `ai_usage(user_id uuid, period text, count int, unique(user_id,period))`; columns `personal_foods.ai_estimated bool`, `food_logs.ai_estimated bool`. All RLS owner-readable.

- [ ] **Step 1: Write the migration**

```sql
-- AI provenance flags + entitlement/quota tables for TrackBing Pro.
alter table public.personal_foods add column if not exists ai_estimated boolean not null default false;
alter table public.food_logs     add column if not exists ai_estimated boolean not null default false;

create table if not exists public.entitlements (
  user_id   uuid primary key references auth.users (id) on delete cascade,
  pro_until timestamptz
);

create table if not exists public.ai_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  period  text not null,                 -- 'YYYY-MM'
  count   integer not null default 0,
  primary key (user_id, period)
);

alter table public.entitlements enable row level security;
alter table public.ai_usage     enable row level security;

-- Owners may READ their own rows. Writes happen via the service role in the
-- edge function (service role bypasses RLS), so no write policy is granted.
drop policy if exists "own entitlements - select" on public.entitlements;
create policy "own entitlements - select" on public.entitlements
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "own ai_usage - select" on public.ai_usage;
create policy "own ai_usage - select" on public.ai_usage
  for select to authenticated using (auth.uid() = user_id);

notify pgrst, 'reload schema';
```

- [ ] **Step 2: Apply it** in the Supabase SQL editor (paste the file). Expected: `Success. No rows returned`.

- [ ] **Step 3: Verify** in the SQL editor:

```sql
select column_name from information_schema.columns
where table_name='personal_foods' and column_name='ai_estimated';   -- 1 row
select tablename, rowsecurity from pg_tables
where schemaname='public' and tablename in ('entitlements','ai_usage');  -- both true
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260629000000_add_ai_and_entitlements.sql
git commit -m "feat: add AI provenance flags and entitlement/usage tables"
```

---

## Task 2: Pure macro validator (`_shared/macros.ts`)

**Files:**
- Create: `supabase/functions/_shared/macros.ts`
- Test: `supabase/functions/_shared/macros.test.ts`

**Interfaces:**
- Produces:
  - `type AiFood = { name: string; brand?: string; serving_label: string; serving_grams: number; kcal: number; protein: number; carbs: number; fat: number; ingredients?: { name: string; kcal: number; protein: number; carbs: number; fat: number }[]; confidence: "high" | "medium" | "low"; notes?: string }`
  - `validateAndNormalize(raw: unknown): AiFood | null` — returns a clamped, sanity-checked food, or `null` if unsalvageable.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { validateAndNormalize } from "./macros";

describe("validateAndNormalize", () => {
  const base = { name: "Egg", serving_label: "1 large", serving_grams: 50,
    kcal: 72, protein: 6, carbs: 0.4, fat: 5, confidence: "high" as const };

  it("accepts a sane food unchanged", () => {
    expect(validateAndNormalize(base)).toMatchObject({ name: "Egg", kcal: 72 });
  });

  it("rejects non-objects and missing name", () => {
    expect(validateAndNormalize(null)).toBeNull();
    expect(validateAndNormalize({ ...base, name: "" })).toBeNull();
  });

  it("clamps negatives to zero", () => {
    const out = validateAndNormalize({ ...base, protein: -3 });
    expect(out?.protein).toBe(0);
  });

  it("lowers confidence when energy math is far off", () => {
    // macros imply ~26 kcal but kcal says 300 -> implausible
    const out = validateAndNormalize({ ...base, kcal: 300, protein: 1, carbs: 1, fat: 2 });
    expect(out?.confidence).toBe("low");
  });

  it("rejects absurd caps", () => {
    expect(validateAndNormalize({ ...base, kcal: 999999 })).toBeNull();
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run supabase/functions/_shared/macros.test.ts`
Expected: FAIL — cannot find `./macros`.

- [ ] **Step 3: Implement `macros.ts`**

```ts
export type AiFood = {
  name: string;
  brand?: string;
  serving_label: string;
  serving_grams: number;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  ingredients?: { name: string; kcal: number; protein: number; carbs: number; fat: number }[];
  confidence: "high" | "medium" | "low";
  notes?: string;
};

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};
const clampNonNeg = (n: number) => (n < 0 ? 0 : n);

// Reject clearly impossible single-serving values.
const MAX_KCAL = 10000;
const MAX_GRAMS = 50000;

export function validateAndNormalize(raw: unknown): AiFood | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const name = typeof r.name === "string" ? r.name.trim() : "";
  if (!name) return null;

  const kcal = clampNonNeg(num(r.kcal));
  const protein = clampNonNeg(num(r.protein));
  const carbs = clampNonNeg(num(r.carbs));
  const fat = clampNonNeg(num(r.fat));
  const serving_grams = clampNonNeg(num(r.serving_grams));
  if ([kcal, protein, carbs, fat, serving_grams].some((n) => Number.isNaN(n))) return null;
  if (kcal > MAX_KCAL || serving_grams > MAX_GRAMS) return null;

  // Energy cross-check: Atwater estimate vs reported kcal.
  const estimate = 4 * protein + 4 * carbs + 9 * fat;
  let confidence: AiFood["confidence"] =
    r.confidence === "high" || r.confidence === "medium" || r.confidence === "low"
      ? (r.confidence as AiFood["confidence"])
      : "medium";
  const tolerance = Math.max(30, estimate * 0.25);
  if (Math.abs(estimate - kcal) > tolerance) confidence = "low";

  return {
    name,
    brand: typeof r.brand === "string" ? r.brand.trim() || undefined : undefined,
    serving_label: typeof r.serving_label === "string" && r.serving_label.trim()
      ? r.serving_label.trim() : "1 serving",
    serving_grams: serving_grams || 100,
    kcal: Math.round(kcal),
    protein: Math.round(protein * 10) / 10,
    carbs: Math.round(carbs * 10) / 10,
    fat: Math.round(fat * 10) / 10,
    confidence,
    notes: typeof r.notes === "string" ? r.notes.trim() || undefined : undefined,
  };
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npx vitest run supabase/functions/_shared/macros.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Ensure vitest picks up the new path.** If `npx vitest run` (no path) does not include the file, add `supabase/functions/**/*.test.ts` to the vitest `include` (check `vitest.config.*`; if none, add `test.include` in `package.json` or a new `vitest.config.ts`). Re-run `npm test` and confirm the macros tests appear in the count.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/macros.ts supabase/functions/_shared/macros.test.ts
git commit -m "feat: add AI macro validation/normalization helper"
```

---

## Task 3: Pure quota/entitlement helpers (`_shared/quota.ts`)

**Files:**
- Create: `supabase/functions/_shared/quota.ts`
- Test: `supabase/functions/_shared/quota.test.ts`

**Interfaces:**
- Produces:
  - `currentPeriod(d?: Date): string` → `'YYYY-MM'`
  - `isProActive(proUntil: string | null, now?: Date): boolean`
  - `type QuotaDecision = { allowed: boolean; reason?: "over_free_quota" | "over_pro_cap" }`
  - `decideQuota(args: { isPro: boolean; monthCount: number; dayCount: number; freeMonthly: number; proDaily: number }): QuotaDecision`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { currentPeriod, isProActive, decideQuota } from "./quota";

describe("quota helpers", () => {
  it("formats period as YYYY-MM", () => {
    expect(currentPeriod(new Date("2026-06-29T00:00:00Z"))).toBe("2026-06");
  });
  it("pro active only when pro_until is in the future", () => {
    const now = new Date("2026-06-29T00:00:00Z");
    expect(isProActive("2026-07-01T00:00:00Z", now)).toBe(true);
    expect(isProActive("2026-06-01T00:00:00Z", now)).toBe(false);
    expect(isProActive(null, now)).toBe(false);
  });
  it("free user blocked at monthly quota", () => {
    expect(decideQuota({ isPro: false, monthCount: 7, dayCount: 0, freeMonthly: 7, proDaily: 100 }))
      .toEqual({ allowed: false, reason: "over_free_quota" });
    expect(decideQuota({ isPro: false, monthCount: 6, dayCount: 0, freeMonthly: 7, proDaily: 100 }).allowed)
      .toBe(true);
  });
  it("pro user blocked only at daily cap", () => {
    expect(decideQuota({ isPro: true, monthCount: 9999, dayCount: 100, freeMonthly: 7, proDaily: 100 }))
      .toEqual({ allowed: false, reason: "over_pro_cap" });
    expect(decideQuota({ isPro: true, monthCount: 9999, dayCount: 99, freeMonthly: 7, proDaily: 100 }).allowed)
      .toBe(true);
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run supabase/functions/_shared/quota.test.ts`
Expected: FAIL — cannot find `./quota`.

- [ ] **Step 3: Implement `quota.ts`**

```ts
export function currentPeriod(d: Date = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function isProActive(proUntil: string | null, now: Date = new Date()): boolean {
  if (!proUntil) return false;
  const t = Date.parse(proUntil);
  return Number.isFinite(t) && t > now.getTime();
}

export type QuotaDecision = { allowed: boolean; reason?: "over_free_quota" | "over_pro_cap" };

export function decideQuota(args: {
  isPro: boolean; monthCount: number; dayCount: number; freeMonthly: number; proDaily: number;
}): QuotaDecision {
  if (args.isPro) {
    return args.dayCount >= args.proDaily
      ? { allowed: false, reason: "over_pro_cap" }
      : { allowed: true };
  }
  return args.monthCount >= args.freeMonthly
    ? { allowed: false, reason: "over_free_quota" }
    : { allowed: true };
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npx vitest run supabase/functions/_shared/quota.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/quota.ts supabase/functions/_shared/quota.test.ts
git commit -m "feat: add AI quota/entitlement helpers"
```

---

## Task 4: `ai-food` Edge Function

**Files:**
- Create: `supabase/functions/ai-food/index.ts`

**Interfaces:**
- Consumes: `validateAndNormalize`, `AiFood` (Task 2); `currentPeriod`, `isProActive`, `decideQuota` (Task 3).
- Produces (HTTP): `POST /functions/v1/ai-food` body `{ query: string, mode?: "auto" | "fill" }` → `200 { food: AiFood }` | `402 { error: "over_free_quota" | "over_pro_cap" }` | `400 { error: "bad_request" }` | `401`.

- [ ] **Step 1: Implement the function**

```ts
// supabase/functions/ai-food/index.ts
import { createClient } from "jsr:@supabase/supabase-js@2";
import { validateAndNormalize, type AiFood } from "../_shared/macros.ts";
import { currentPeriod, isProActive, decideQuota } from "../_shared/quota.ts";

const FREE_MONTHLY = 7;
const PRO_DAILY = 100;
const MAX_QUERY = 200;

const SYSTEM_PROMPT =
  `You are a nutrition database. Given a food or meal description, return ONLY JSON ` +
  `matching: {"name":string,"brand"?:string,"serving_label":string,"serving_grams":number,` +
  `"kcal":number,"protein":number,"carbs":number,"fat":number,` +
  `"ingredients"?:[{"name":string,"kcal":number,"protein":number,"carbs":number,"fat":number}],` +
  `"confidence":"high"|"medium"|"low","notes"?:string}. ` +
  `Macros are grams PER SERVING. Use realistic values. If unsure, set confidence "low".`;

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const authHeader = req.headers.get("Authorization") ?? "";
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json(401, { error: "unauthorized" });

  let body: { query?: unknown; mode?: unknown };
  try { body = await req.json(); } catch { return json(400, { error: "bad_request" }); }
  const query = typeof body.query === "string" ? body.query.trim().slice(0, MAX_QUERY) : "";
  if (!query) return json(400, { error: "bad_request" });

  // Service-role client for privileged reads/writes (bypasses RLS).
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const now = new Date();
  const period = currentPeriod(now);
  const dayStart = new Date(now); dayStart.setUTCHours(0, 0, 0, 0);

  const { data: ent } = await admin.from("entitlements")
    .select("pro_until").eq("user_id", user.id).maybeSingle();
  const pro = isProActive(ent?.pro_until ?? null, now);

  const { data: usageRow } = await admin.from("ai_usage")
    .select("count").eq("user_id", user.id).eq("period", period).maybeSingle();
  const monthCount = usageRow?.count ?? 0;
  // Pro daily cap: a separate lightweight count keyed by day.
  const dayPeriod = `${period}-${String(now.getUTCDate()).padStart(2, "0")}`;
  const { data: dayRow } = await admin.from("ai_usage")
    .select("count").eq("user_id", user.id).eq("period", dayPeriod).maybeSingle();
  const dayCount = dayRow?.count ?? 0;

  const decision = decideQuota({ isPro: pro, monthCount, dayCount, freeMonthly: FREE_MONTHLY, proDaily: PRO_DAILY });
  if (!decision.allowed) return json(402, { error: decision.reason });

  // Call DeepSeek (OpenAI-compatible).
  const dsRes = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${Deno.env.get("DEEPSEEK_API_KEY")!}`,
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: query },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
    }),
  });
  if (!dsRes.ok) return json(502, { error: "ai_unavailable" });
  const dsJson = await dsRes.json();
  let parsed: unknown;
  try { parsed = JSON.parse(dsJson.choices?.[0]?.message?.content ?? "null"); }
  catch { return json(502, { error: "ai_unavailable" }); }

  const food: AiFood | null = validateAndNormalize(parsed);
  if (!food) return json(502, { error: "ai_unavailable" });

  // Best-effort usage increment (month + day) AFTER a successful result.
  await admin.rpc("increment_ai_usage", { p_user: user.id, p_period: period });
  await admin.rpc("increment_ai_usage", { p_user: user.id, p_period: dayPeriod });

  return json(200, { food });
});

function json(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status, headers: { "Content-Type": "application/json" },
  });
}
```

- [ ] **Step 2: Add the `increment_ai_usage` RPC** (atomic upsert-increment). Create migration `supabase/migrations/20260629000100_ai_usage_increment.sql`:

```sql
create or replace function public.increment_ai_usage(p_user uuid, p_period text)
returns void language sql security definer set search_path = public as $$
  insert into public.ai_usage (user_id, period, count) values (p_user, p_period, 1)
  on conflict (user_id, period) do update set count = public.ai_usage.count + 1;
$$;
revoke all on function public.increment_ai_usage(uuid, text) from public, anon, authenticated;
notify pgrst, 'reload schema';
```
Apply it in the SQL editor. (SECURITY DEFINER + revoked from clients: only the service role calls it.)

- [ ] **Step 3: Set Edge Function secrets** (Supabase dashboard → Edge Functions → Secrets, or `supabase secrets set`): `DEEPSEEK_API_KEY`. `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` are provided to functions by default.

- [ ] **Step 4: Deploy** the function (Supabase dashboard "Deploy" or `supabase functions deploy ai-food`).

- [ ] **Step 5: Smoke-test with a real user JWT** (grab one from the app's localStorage `sb-…-auth-token`, field `access_token`):

```bash
curl -s -X POST "$SUPABASE_URL/functions/v1/ai-food" \
  -H "Authorization: Bearer $USER_JWT" -H "Content-Type: application/json" \
  -d '{"query":"2 large eggs","mode":"auto"}' | jq
```
Expected: `{ "food": { "name": ..., "kcal": ..., "confidence": ... } }`. Run it 8 times as a free user → the 8th returns `402 {"error":"over_free_quota"}`.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/ai-food/index.ts supabase/migrations/20260629000100_ai_usage_increment.sql
git commit -m "feat: add ai-food edge function with quota and macro validation"
```

---

## Task 5: Client lib (`src/lib/aiFood.ts`)

**Files:**
- Create: `src/lib/aiFood.ts`
- Test: `src/lib/aiFood.test.ts`

**Interfaces:**
- Consumes: `supabase` (`src/lib/supabase.ts`).
- Produces:
  - `type AiFood` (same shape as Task 2, re-declared client-side).
  - `type AiFoodResult = { ok: true; food: AiFood } | { ok: false; reason: "over_free_quota" | "over_pro_cap" | "error" }`
  - `requestAiFood(query: string, mode?: "auto" | "fill"): Promise<AiFoodResult>`

- [ ] **Step 1: Write the failing test** (mock `supabase.functions.invoke`)

```ts
import { describe, it, expect, vi } from "vitest";
vi.mock("@/src/lib/supabase", () => ({
  supabase: { functions: { invoke: vi.fn() } },
}));
import { supabase } from "@/src/lib/supabase";
import { requestAiFood } from "./aiFood";

describe("requestAiFood", () => {
  it("returns the food on success", async () => {
    (supabase.functions.invoke as any).mockResolvedValue({ data: { food: { name: "Egg" } }, error: null });
    const r = await requestAiFood("egg");
    expect(r).toEqual({ ok: true, food: { name: "Egg" } });
  });
  it("maps a 402 quota error", async () => {
    (supabase.functions.invoke as any).mockResolvedValue({
      data: { error: "over_free_quota" },
      error: { context: { status: 402 } },
    });
    const r = await requestAiFood("egg");
    expect(r).toEqual({ ok: false, reason: "over_free_quota" });
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run src/lib/aiFood.test.ts` → FAIL (no `./aiFood`).

- [ ] **Step 3: Implement `aiFood.ts`**

```ts
import { supabase } from "@/src/lib/supabase";

export type AiFood = {
  name: string; brand?: string; serving_label: string; serving_grams: number;
  kcal: number; protein: number; carbs: number; fat: number;
  ingredients?: { name: string; kcal: number; protein: number; carbs: number; fat: number }[];
  confidence: "high" | "medium" | "low"; notes?: string;
};

export type AiFoodResult =
  | { ok: true; food: AiFood }
  | { ok: false; reason: "over_free_quota" | "over_pro_cap" | "error" };

export async function requestAiFood(
  query: string, mode: "auto" | "fill" = "auto",
): Promise<AiFoodResult> {
  const { data, error } = await supabase.functions.invoke<{ food?: AiFood; error?: string }>(
    "ai-food", { body: { query, mode } },
  );
  if (data?.food) return { ok: true, food: data.food };
  const reason = data?.error;
  if (reason === "over_free_quota" || reason === "over_pro_cap") return { ok: false, reason };
  return { ok: false, reason: "error" };
}
```

- [ ] **Step 4: Run tests, verify pass** → `npx vitest run src/lib/aiFood.test.ts` PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/aiFood.ts src/lib/aiFood.test.ts
git commit -m "feat: add client wrapper for ai-food function"
```

---

## Task 6: AI UI — review sheet, badge, two entry points, paywall

**Files:**
- Create: `src/components/ai/AiEstimateBadge.tsx`, `src/components/ai/AiFoodSheet.tsx`, `src/components/ai/UpgradePrompt.tsx`
- Modify: Find Food screen (ask-box entry) and create-food form (AI-fill button) — locate exact paths first (Step 1); `src/lib/foodSearch.ts` persistence to set `ai_estimated` on save.

**Interfaces:**
- Consumes: `requestAiFood`, `AiFood` (Task 5); existing `personal_foods` insert + `food_logs` insert patterns (find in the Find Food / cookbook screens).
- `AiFoodSheet` props: `{ visible: boolean; food: AiFood | null; onClose: () => void; onSave: (edited: AiFood, opts: { toMyFoods: boolean; log: boolean }) => Promise<void> }`.
- `AiEstimateBadge`: renders a small "✨ AI estimate" pill using `Colors` tokens.

- [ ] **Step 1: Locate integration points.** Run and record exact files/lines:

```bash
grep -rln "searchAllFoods\|personal_foods" app src | sort -u
grep -rln "Find Food\|FindFood\|AddFood\|create.*food\|My Foods" app src
```
Identify (a) the screen with the food search box (ask-box host) and (b) the create-food form (AI-fill host).

- [ ] **Step 2: Build `AiEstimateBadge.tsx`** — a pill (`✨ AI estimate`) styled with `Colors` from `src/styles/colors.ts`, matching existing badge/pill styling in the app. Render it in My Foods rows and log rows wherever `ai_estimated === true`.

- [ ] **Step 3: Build `AiFoodSheet.tsx`** — a modal showing editable fields (name, serving_label, serving_grams, kcal, protein, carbs, fat), the `AiEstimateBadge`, the `confidence`/`notes` line, and two actions: **Save to My Foods** and **Log it** (either/both). On confirm, call `onSave(edited, opts)`. Reuse the app's existing modal + `SweetFeedback`/notify patterns. Numbers are editable; the badge is always shown.

- [ ] **Step 4: Wire entry point (C) — ask box.** On the food-search screen, add an "✨ Ask AI" action that takes the current query, calls `requestAiFood(query, "auto")`, and on `ok` opens `AiFoodSheet`; on `over_free_quota`/`over_pro_cap` shows `UpgradePrompt`; on `error` shows a friendly notify.

- [ ] **Step 5: Wire entry point (D) — AI fill.** On the create-food form, add an "✨ AI fill" button that calls `requestAiFood(nameField, "fill")` and populates the empty macro fields from the result (still inside the form, user reviews before saving). Quota/error handling same as Step 4.

- [ ] **Step 6: Persist provenance.** When saving an AI food to `personal_foods` (and when logging to `food_logs`), set `ai_estimated: true`. Render `AiEstimateBadge` in My Foods rows and log rows where the flag is true.

- [ ] **Step 7: Build `UpgradePrompt.tsx`** — a simple sheet: "You've used your free AI lookups this month. Pro is coming soon." (Becomes the real Buy-Pro entry in Plan B.)

- [ ] **Step 8: Verify in-browser (Playwright).** Start Expo web, log in with the demo account, and:
  - Ask box: type "2 large eggs" → AI sheet opens with macros + badge → Save to My Foods → row shows badge.
  - AI fill: on create-food form, type a name → AI fill populates macros.
  - Exhaust quota (8th call) → `UpgradePrompt` shows.
  - Screenshot at 375 / 768 / 1440; confirm no console errors / failed requests.
  (Reuse the Playwright approach from `output/playwright/verify-rpc-2026-06-27`.)

- [ ] **Step 9: Run full checks**

Run: `npm run typecheck && npm test && npm run lint`
Expected: typecheck clean; all tests pass (incl. macros/quota/aiFood); no new lint errors.

- [ ] **Step 10: Commit**

```bash
git add src/components/ai app src/lib/foodSearch.ts
git commit -m "feat: add AI food ask box, AI-fill, review sheet, and provenance badge"
```

---

## Self-Review (completed against the spec)

- **Spec coverage:** §3.1 ai-food → Task 4; §3.2 schema → Tasks 2/4; §3.3 accuracy guard → Task 2; §3.4 two surfaces → Task 6 (Steps 4–5); §3.5 provenance → Tasks 1 & 6 (Steps 2/6); §4.1 quota/entitlement → Tasks 1, 3, 4; §5 data model (AI-relevant tables) → Task 1; §6 security → Global Constraints + Task 4 (auth, server quota, service-role writes, output-as-data) + Task 1 (RLS). **Deferred to Plan B:** §4.2 `create-payment`, §4.3 `paymongo-webhook`, `payments` table, Buy-Pro UI — by design (separate plan; the quota gate + `UpgradePrompt` placeholder make Plan A shippable).
- **Placeholder scan:** no banned phrases; all code steps contain real code; `UpgradePrompt` placeholder text is an intentional, spec-aligned stub for Plan B.
- **Type consistency:** `AiFood` shape identical in Tasks 2/5; quota helper names (`decideQuota`, `isProActive`, `currentPeriod`) consistent across Tasks 3/4; `requestAiFood` signature consistent Tasks 5/6.

## Open items to confirm before/at integration (from spec §10)
- Exact DeepSeek model id + pricing (plan assumes `deepseek-chat` + `response_format: json_object`).
- Final free quota / pro cap numbers (plan uses 7/mo, 100/day as constants in Task 4).
- Vitest config may need `supabase/functions/**/*.test.ts` added to `include` (Task 2, Step 5).
