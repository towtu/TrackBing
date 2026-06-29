# TrackBing Pro — AI Macro Assistant + Billing

**Status:** Approved design (2026-06-29)
**Author:** towtu
**Scope:** Two layers designed together — (1) an AI feature that turns a food/meal description into structured macros, and (2) a one-time-pass SaaS billing layer that monetizes it. Built so each layer is independently implementable.

---

## 1. Goals & non-goals

**Goals**
- Let a user describe a food or meal in natural language and get accurate-enough, structured macros they review and then save/log.
- Add an "✨ AI fill" affordance to the existing create-food form.
- Monetize via low-priced, one-time **Pro passes** paid through PayMongo (QR Ph / GCash / Maya), with predictable upfront revenue (push the annual pass).
- Keep all secrets server-side and enforce the paywall on the server.

**Non-goals (this spec)**
- Auto-renewing subscriptions / stored cards. Pro is expiry-dated and re-purchased manually (matches QR Ph, which is a one-time push payment).
- Replacing the existing USDA / OpenFoodFacts / gist search. The AI is additive.
- Marketing site, referral systems, team/family plans.

---

## 2. Key decisions (locked)

| # | Decision |
|---|----------|
| Scope | Build AI feature **and** billing layer together, as two clean layers. |
| AI behavior | One engine, two surfaces: **(C)** NL ask box that handles single item *or* meal → lands in My Foods + loggable; **(D)** AI-fill button on the create-food form. |
| Trust | **Always review before commit.** Foods are stamped `ai_estimated = true` with a **persistent "AI estimate" badge** everywhere they appear. |
| Monetization | **Freemium**: free tier keeps all current features + a small monthly AI quota; **Pro** unlocks a high/unlimited AI quota. Low price, push annual. |
| Billing rails | **PayMongo**: QR Ph (no surcharge) + GCash/Maya (**+2% user-facing surcharge**). |
| Recurring model | **One-time Pro passes**, expiry-dated (`pro_until`). No auto-renew. |

**Tunable defaults (not architectural — change freely):**
- Free quota: **7 AI lookups / month** (resets monthly).
- Pro: **unlimited** with a soft anti-abuse cap (~**100/day**).
- Prices: **₱99 / 30-day**, **₱799 / 1-year**.
- DeepSeek model: **`deepseek-chat`** with JSON output mode (exact id confirmed at integration; "v4 pro" is not a known SKU).

---

## 3. Layer 1 — AI Macro Engine

### 3.1 Edge Function: `ai-food`
Mirrors the existing `usda-search` edge function. The **DeepSeek API key lives only in the function's env**, never in the client bundle / `EXPO_PUBLIC_*`.

Request (from authenticated client): `{ query: string, mode: "auto" | "fill" }`.

Server flow:
1. Authenticate the user via the Supabase JWT.
2. Check entitlement + quota (see Layer 2). Over quota / not entitled → `402`-style response the UI turns into an upgrade prompt.
3. Call DeepSeek with a strict system prompt that forces a fixed JSON schema.
4. **Validate & normalize the response server-side** (Section 3.3).
5. Increment usage; return the normalized food.

### 3.2 DeepSeek output schema
```
{
  name: string,
  brand?: string,
  serving_label: string,         // e.g. "1 cup", "2 large eggs"
  serving_grams: number,
  kcal: number,                  // per serving
  protein: number, carbs: number, fat: number,   // grams per serving
  ingredients?: { name: string, kcal: number, protein: number, carbs: number, fat: number }[],
  confidence: "high" | "medium" | "low",
  notes?: string
}
```
`mode: "auto"` decides single-item vs meal (meals return `ingredients[]`). `mode: "fill"` returns just the macro fields for a name already typed on the form.

### 3.3 Accuracy guard (server-side)
Before returning, the function:
- Rejects/repairs implausible values: no negatives; clamp absurd caps.
- Sanity-checks energy: `4·protein + 4·carbs + 9·fat` must be within tolerance of `kcal`; otherwise lower `confidence` and/or recompute kcal from macros.
- Caps `query` length; treats the model output purely as **data** (never HTML, never executed).

### 3.4 UI surfaces (both call `ai-food`)
- **(C) Ask box:** "Describe a food or meal" → proposed food → **review/edit sheet** with the "AI estimate" badge → user taps **Save to My Foods** and/or **Log it**.
- **(D) AI-fill button:** on the create-food form, "✨ AI fill" populates empty macro fields from the typed name; user still reviews before saving.

### 3.5 Provenance
Anything created via AI carries `ai_estimated = true` and renders an **"AI estimate" badge** in My Foods and on log entries — permanently, even after the user edits the numbers.

---

## 4. Layer 2 — Entitlements + Billing

### 4.1 Entitlement
- `entitlements.pro_until timestamptz`. **Pro is active iff `pro_until > now()`.**
- Quota: free = 7/month (monthly reset); Pro = unlimited (soft 100/day cap). Tracked in `ai_usage` and enforced **inside `ai-food`** — the gate is the paywall. Hiding the UI button is not access control.

### 4.2 Edge Function: `create-payment`
- Input: `{ plan: "pro_30d" | "pro_1y", method: "qrph" | "gcash" | "maya" }`.
- **Server** owns the price table and duration; computes amount, adds **+2% only** for `gcash`/`maya`, none for `qrph`.
- Creates the PayMongo charge (QR Ph source / e-wallet source / checkout) and returns the QR payload or redirect URL. Writes a `payments` row as `pending`.

### 4.3 Edge Function: `paymongo-webhook`
- **Verifies the PayMongo webhook signature.**
- On `payment.paid`: look up the `payments` row by PayMongo id; if not already applied, set `entitlements.pro_until = max(now(), pro_until) + plan_duration` and mark the payment `paid`.
- **Idempotent**: deduped by unique `paymongo_id`, so repeated webhook deliveries grant the pass once.
- This webhook is the **only** code path that grants Pro.

---

## 5. Data model (new migrations, all RLS owner-only)

| Table | Change |
|---|---|
| `personal_foods` | + `ai_estimated boolean default false` |
| `food_logs` | + `ai_estimated boolean default false` |
| `entitlements` | `user_id uuid` (PK/FK), `pro_until timestamptz` |
| `ai_usage` | `user_id uuid`, `period text` (e.g. `2026-06`), `count int`; unique `(user_id, period)` |
| `payments` | `id`, `user_id`, `paymongo_id text unique`, `plan`, `amount int`, `method`, `status`, `created_at` |

RLS: `entitlements`, `ai_usage`, `payments` are owner-readable (`auth.uid() = user_id`); **writes to `entitlements`/`payments` happen via the service role inside edge functions only** (clients never write entitlements). `ai_usage` is written by `ai-food` (service role).

---

## 6. Security (OWASP walk — this is the sensitive layer)

- **Secrets:** DeepSeek + PayMongo keys in edge-function env only; never in the client bundle or `EXPO_PUBLIC_*`.
- **AI endpoint:** auth required; **server-side quota + rate-limit**; `query` length cap; model output is data only (no HTML/exec).
- **Payments — the three must-haves:** amount **computed server-side** (never trust a client price); **webhook signature verified**; **idempotent** grants (unique `paymongo_id`).
- **Authorization:** entitlement/quota checked server-side on every AI call; clients can never write `entitlements`.
- **Input validation:** validate all edge-function inputs (plan/method enums, query length) server-side.
- Generic error messages to users; detailed errors to function logs only.

---

## 7. Components / new surfaces

**Edge functions (3):** `ai-food`, `create-payment`, `paymongo-webhook`.
**Client:** AI ask-box entry point; review/edit sheet (with badge); AI-fill button on create-food form; paywall/upgrade screen; "AI estimate" badges in My Foods + logs; "Buy Pro" flow (plan + method picker → QR/redirect → success state).
**Reused patterns:** edge-function-behind-secret (`usda-search`), `personal_foods` + `foodSearch`, `SweetFeedback`/notify for feedback, existing RLS migration style.

---

## 8. Testing / verification

- **Unit:** macro sanity-validator; surcharge math (qrph vs gcash/maya); `pro_until` extension logic; webhook idempotency (double-deliver → one grant); quota increment + monthly reset.
- **Manual / Playwright:** AI flow with DeepSeek mocked; paywall gating exactly at quota; PayMongo **test-mode** purchase happy path → webhook → Pro active; badge rendering at 375 / 768 / 1440; console/network clean.

---

## 9. Build order (for the implementation plan)

1. **Data layer** — migrations (flags, `entitlements`, `ai_usage`, `payments`) + RLS.
2. **AI engine** — `ai-food` edge function (DeepSeek + validation), no UI yet (curl-tested).
3. **AI UI** — ask box + review sheet + AI-fill button + badges.
4. **Entitlement gate** — wire quota/`pro_until` into `ai-food`; paywall UI.
5. **Billing** — `create-payment` + `paymongo-webhook` (PayMongo test mode) + Buy Pro UI.
6. **Verify** — unit + Playwright + security walk; then live PayMongo keys.

---

## 10. Open items to confirm at integration

- Exact DeepSeek model id + current pricing (assume `deepseek-chat` + JSON mode).
- Final quota numbers and pass prices (defaults in §2).
- PayMongo: confirm QR Ph + GCash + Maya are enabled on the account, and exact provider fees.
