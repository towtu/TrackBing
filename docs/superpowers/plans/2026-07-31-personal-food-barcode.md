# Personal Food Barcode Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users optionally save a numeric barcode with a private My Food and create an unmatched scanned product manually so later scans resolve their saved food first.

**Architecture:** A pure barcode module owns strict parsing and editable-field sanitization. The food-search layer composes an owner-scoped Supabase lookup with the existing encoded Open Food Facts lookup, while an idempotent migration enforces digit format, per-user uniqueness, and owner-only RLS. Scan passes confirmed misses into Create My Food through a validated route parameter; Cookbook remains untouched.

**Tech Stack:** Expo 54, React Native 0.81, Expo Router, TypeScript strict mode, Supabase/PostgreSQL RLS, Vitest, Playwright CLI.

---

## Existing-work guard

Before each commit, confirm these user-owned files remain unstaged:

```text
app/(tabs)/add.tsx
app/(tabs)/cookbook.tsx
app/(tabs)/stats.tsx
codex.diff
```

This plan does not modify Cookbook or Stats. It does not need to modify Add
Food because its existing **Create My Food** route already opens
`app/create-food.tsx`.

### Task 0: Record the baseline

**Files:**
- Read only: `app/(tabs)/add.tsx`
- Read only: `app/(tabs)/cookbook.tsx`
- Read only: `app/(tabs)/stats.tsx`

- [ ] **Step 1: Record status and branch**

Run:

```bash
git branch --show-current
git status --short
git diff -- app/'(tabs)'/add.tsx app/'(tabs)'/cookbook.tsx app/'(tabs)'/stats.tsx
```

Expected: branch `feat/ai-macros`; only the known user-owned changes are
unstaged.

- [ ] **Step 2: Run the focused food baseline**

Run:

```bash
npm test -- src/lib/aiFoodUi.test.ts src/lib/beeQuickLog.test.ts
npm run typecheck
```

Expected: both test files and typecheck pass before behavior changes.

### Task 1: Build strict barcode parsing with TDD

**Files:**
- Create: `src/lib/barcodes.test.ts`
- Create: `src/lib/barcodes.ts`

- [ ] **Step 1: Write the failing contract tests**

Create `src/lib/barcodes.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseBarcode, sanitizeBarcodeInput } from "./barcodes";

describe("sanitizeBarcodeInput", () => {
  it("keeps digits and leading zeroes while filtering typed characters", () => {
    expect(sanitizeBarcodeInput(" 0123-45ab ")).toBe("012345");
  });

  it("caps editable input at 32 digits", () => {
    expect(sanitizeBarcodeInput("1".repeat(40))).toBe("1".repeat(32));
  });
});

describe("parseBarcode", () => {
  it("accepts a valid barcode without converting it to a number", () => {
    expect(parseBarcode("00012345")).toEqual({
      ok: true,
      barcode: "00012345",
    });
  });

  it("accepts an empty optional barcode as null", () => {
    expect(parseBarcode("", { optional: true })).toEqual({
      ok: true,
      barcode: null,
    });
  });

  it("rejects empty required input", () => {
    expect(parseBarcode("")).toEqual({
      ok: false,
      reason: "Enter a barcode number.",
    });
  });

  it("rejects values shorter than four digits", () => {
    expect(parseBarcode("123")).toEqual({
      ok: false,
      reason: "Barcode numbers must contain 4 to 32 digits.",
    });
  });

  it("rejects letters, punctuation, and QR URLs instead of extracting digits", () => {
    expect(parseBarcode("4800-1234").ok).toBe(false);
    expect(parseBarcode("https://example.com/48001234").ok).toBe(false);
  });

  it("rejects values longer than 32 digits", () => {
    expect(parseBarcode("1".repeat(33)).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- src/lib/barcodes.test.ts
```

Expected: FAIL because `./barcodes` does not exist.

- [ ] **Step 3: Implement the minimal pure module**

Create `src/lib/barcodes.ts`:

```ts
const BARCODE_PATTERN = /^[0-9]{4,32}$/;

export type ParsedBarcode =
  | { ok: true; barcode: string | null }
  | { ok: false; reason: string };

export function sanitizeBarcodeInput(value: string): string {
  return value.replace(/\D/g, "").slice(0, 32);
}

export function parseBarcode(
  value: string,
  options: { optional?: boolean } = {},
): ParsedBarcode {
  const barcode = value.trim();

  if (!barcode && options.optional) {
    return { ok: true, barcode: null };
  }

  if (!barcode) {
    return { ok: false, reason: "Enter a barcode number." };
  }

  if (!BARCODE_PATTERN.test(barcode)) {
    return {
      ok: false,
      reason: "Barcode numbers must contain 4 to 32 digits.",
    };
  }

  return { ok: true, barcode };
}
```

- [ ] **Step 4: Verify GREEN**

Run:

```bash
npm test -- src/lib/barcodes.test.ts
npm run typecheck
```

Expected: eight tests pass and typecheck exits 0.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/lib/barcodes.ts src/lib/barcodes.test.ts
git diff --cached --check
git commit -m "feat: add strict barcode validation"
```

### Task 2: Add owner-safe barcode storage

**Files:**
- Create: `supabase/migrations/20260731000000_add_personal_food_barcodes.sql`

- [ ] **Step 1: Write the idempotent migration**

Create the migration:

```sql
-- Optional numeric barcodes for owner-created foods.
alter table public.personal_foods
  add column if not exists barcode text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'personal_foods_barcode_digits'
      and conrelid = 'public.personal_foods'::regclass
  ) then
    alter table public.personal_foods
      add constraint personal_foods_barcode_digits
      check (barcode is null or barcode ~ '^[0-9]{4,32}$');
  end if;
end
$$;

create unique index if not exists personal_foods_user_barcode_unique
  on public.personal_foods (user_id, barcode)
  where barcode is not null;

alter table public.personal_foods enable row level security;

drop policy if exists "Users manage own rows" on public.personal_foods;
create policy "Users manage own rows"
  on public.personal_foods
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

notify pgrst, 'reload schema';
```

- [ ] **Step 2: Perform source-level migration checks**

Run:

```bash
rg -n "add column if not exists barcode|personal_foods_barcode_digits|personal_foods_user_barcode_unique|enable row level security|auth.uid\\(\\) = user_id|reload schema" supabase/migrations/20260731000000_add_personal_food_barcodes.sql
```

Expected: all six safeguards appear.

- [ ] **Step 3: Document deployment verification**

After applying the migration in the target Supabase project, run:

```sql
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'personal_foods'
  and column_name = 'barcode';

select indexname
from pg_indexes
where schemaname = 'public'
  and tablename = 'personal_foods'
  and indexname = 'personal_foods_user_barcode_unique';

select rowsecurity
from pg_tables
where schemaname = 'public' and tablename = 'personal_foods';
```

Expected: nullable text column, unique index present, and `rowsecurity = true`.

- [ ] **Step 4: Commit**

Run:

```bash
git add supabase/migrations/20260731000000_add_personal_food_barcodes.sql
git diff --cached --check
git commit -m "feat: store private personal food barcodes"
```

### Task 3: Resolve personal barcodes before Open Food Facts

**Files:**
- Create: `src/lib/foodSearchBarcode.test.ts`
- Modify: `src/lib/foodSearch.ts`

- [ ] **Step 1: Write failing precedence and outcome tests**

Create `src/lib/foodSearchBarcode.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import {
  resolveBarcodeWithSources,
  type BarcodeSourceLookup,
} from "./foodSearch";
import type { FoodItem } from "./macros";

const personalFood: FoodItem = {
  code: "personal-1",
  product_name: "My Cereal",
  brands: "My Food",
  default_unit: "g",
  nutriments: {
    "energy-kcal_100g": 380,
    proteins_100g: 8,
    carbohydrates_100g: 75,
    fat_100g: 4,
  },
};

const publicFood: FoodItem = {
  ...personalFood,
  code: "01234567",
  product_name: "Public Cereal",
  brands: "Packaged",
};

describe("resolveBarcodeWithSources", () => {
  it("returns the personal match without calling Open Food Facts", async () => {
    const findPersonal = vi.fn(async () => ({
      ok: true as const,
      food: personalFood,
    }));
    const findPublic = vi.fn(async () => ({
      ok: true as const,
      food: publicFood,
      hasNutrition: true,
    }));

    await expect(
      resolveBarcodeWithSources("01234567", { findPersonal, findPublic }),
    ).resolves.toEqual({
      ok: true,
      source: "personal",
      food: personalFood,
      hasNutrition: true,
    });
    expect(findPublic).not.toHaveBeenCalled();
  });

  it("falls back to Open Food Facts after a personal miss", async () => {
    const lookups: BarcodeSourceLookup = {
      findPersonal: vi.fn(async () => ({ ok: true, food: null })),
      findPublic: vi.fn(async () => ({
        ok: true,
        food: publicFood,
        hasNutrition: true,
      })),
    };

    await expect(
      resolveBarcodeWithSources("01234567", lookups),
    ).resolves.toMatchObject({
      ok: true,
      source: "open-food-facts",
      food: publicFood,
    });
  });

  it("returns not-found only when both sources confirm a miss", async () => {
    await expect(
      resolveBarcodeWithSources("01234567", {
        findPersonal: async () => ({ ok: true, food: null }),
        findPublic: async () => ({ ok: false, reason: "not-found" }),
      }),
    ).resolves.toEqual({ ok: false, reason: "not-found" });
  });

  it("does not call the public service after a personal lookup failure", async () => {
    const findPublic = vi.fn();
    await expect(
      resolveBarcodeWithSources("01234567", {
        findPersonal: async () => ({ ok: false, reason: "unreachable" }),
        findPublic,
      }),
    ).resolves.toEqual({ ok: false, reason: "unreachable" });
    expect(findPublic).not.toHaveBeenCalled();
  });

  it("rejects invalid scanner payloads before either lookup", async () => {
    const findPersonal = vi.fn();
    const findPublic = vi.fn();
    await expect(
      resolveBarcodeWithSources("https://example.com/1234", {
        findPersonal,
        findPublic,
      }),
    ).resolves.toEqual({ ok: false, reason: "invalid" });
    expect(findPersonal).not.toHaveBeenCalled();
    expect(findPublic).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- src/lib/foodSearchBarcode.test.ts
```

Expected: FAIL because `resolveBarcodeWithSources` is not exported.

- [ ] **Step 3: Add source-composition types and pure orchestration**

In `src/lib/foodSearch.ts`, import `parseBarcode` and add:

```ts
import { parseBarcode } from "./barcodes";

type PersonalBarcodeResult =
  | { ok: true; food: FoodItem | null }
  | { ok: false; reason: "auth-required" | "unreachable" };

export type BarcodeSourceLookup = {
  findPersonal: (barcode: string) => Promise<PersonalBarcodeResult>;
  findPublic: typeof lookupBarcode;
};

export type ResolvedBarcode =
  | {
      ok: true;
      source: "personal" | "open-food-facts";
      food: FoodItem;
      hasNutrition: boolean;
    }
  | {
      ok: false;
      reason: "invalid" | "auth-required" | "not-found" | "unreachable";
    };

export async function resolveBarcodeWithSources(
  rawCode: string,
  sources: BarcodeSourceLookup,
): Promise<ResolvedBarcode> {
  const parsed = parseBarcode(rawCode);
  if (!parsed.ok || !parsed.barcode) {
    return { ok: false, reason: "invalid" };
  }

  const personal = await sources.findPersonal(parsed.barcode);
  if (!personal.ok) return personal;
  if (personal.food) {
    return {
      ok: true,
      source: "personal",
      food: personal.food,
      hasNutrition: true,
    };
  }

  const publicResult = await sources.findPublic(parsed.barcode);
  if (!publicResult.ok) return publicResult;
  return {
    ok: true,
    source: "open-food-facts",
    food: publicResult.food,
    hasNutrition: publicResult.hasNutrition,
  };
}
```

- [ ] **Step 4: Add the owner-scoped Supabase adapter**

In `src/lib/foodSearch.ts`, add:

```ts
type PersonalBarcodeRow = {
  id: string;
  name: string;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  default_unit: string | null;
  ai_estimated: boolean | null;
};

async function findPersonalFoodByBarcode(
  barcode: string,
): Promise<PersonalBarcodeResult> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: "auth-required" };

  const { data, error } = await supabase
    .from("personal_foods")
    .select("id,name,calories,protein,carbs,fat,default_unit,ai_estimated")
    .eq("user_id", user.id)
    .eq("barcode", barcode)
    .maybeSingle();

  if (error) {
    console.warn("Personal barcode lookup failed");
    return { ok: false, reason: "unreachable" };
  }
  if (!data) return { ok: true, food: null };

  const row = data as PersonalBarcodeRow;
  return {
    ok: true,
    food: {
      code: barcode,
      product_name: row.name,
      brands: "My Food",
      default_unit: row.default_unit || "g",
      serving_quantity:
        row.default_unit === "g" || row.default_unit === "ml" ? 100 : 1,
      nutriments: {
        "energy-kcal_100g": numberOrZero(row.calories),
        proteins_100g: numberOrZero(row.protein),
        carbohydrates_100g: numberOrZero(row.carbs),
        fat_100g: numberOrZero(row.fat),
      },
      original_id: row.id,
      ai_estimated: !!row.ai_estimated,
    },
  };
}

export function resolveBarcode(code: string): Promise<ResolvedBarcode> {
  return resolveBarcodeWithSources(code, {
    findPersonal: findPersonalFoodByBarcode,
    findPublic: lookupBarcode,
  });
}
```

Keep `lookupBarcode` as the only Open Food Facts barcode implementation; it
already applies `encodeURIComponent`, retries transient failures, and
distinguishes `not-found` from `unreachable`.

- [ ] **Step 5: Verify GREEN**

Run:

```bash
npm test -- src/lib/barcodes.test.ts src/lib/foodSearchBarcode.test.ts
npm run typecheck
```

Expected: all barcode tests pass and typecheck exits 0.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/lib/foodSearch.ts src/lib/foodSearchBarcode.test.ts
git diff --cached --check
git commit -m "feat: resolve saved personal food barcodes first"
```

### Task 4: Add the optional Create My Food barcode field

**Files:**
- Modify: `app/create-food.tsx`

- [ ] **Step 1: Add validated route and form state**

Import:

```ts
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  parseBarcode,
  sanitizeBarcodeInput,
} from "@/src/lib/barcodes";
```

Inside the component, initialize the state:

```ts
const params = useLocalSearchParams<{ barcode?: string | string[] }>();
const [barcode, setBarcode] = useState("");
```

After the feedback state declaration, add:

```ts
useEffect(() => {
  const routeBarcode = Array.isArray(params.barcode)
    ? params.barcode[0]
    : params.barcode;
  if (!routeBarcode) return;

  const parsed = parseBarcode(routeBarcode);
  if (parsed.ok && parsed.barcode) {
    setBarcode(parsed.barcode);
    return;
  }

  setBarcode("");
  setFeedback({
    type: "warning",
    title: "Barcode not carried over",
    message: "Use a barcode containing 4 to 32 digits.",
  });
}, [params.barcode]);
```

This shows the existing warning feedback for an invalid non-empty route value
and leaves the field blank.

- [ ] **Step 2: Validate and persist on save**

At the start of `handleSave`, after the existing submit guard:

```ts
const parsedBarcode = parseBarcode(barcode, { optional: true });
if (!parsedBarcode.ok) {
  setFeedback({
    type: "warning",
    title: "Check the barcode",
    message: parsedBarcode.reason,
  });
  return;
}
```

Add both defense-in-depth ownership and the nullable barcode to the insert:

```ts
{
  user_id: user.id,
  name,
  calories: parseFloat(cal) || 0,
  protein: parseFloat(prot) || 0,
  carbs: parseFloat(carbs) || 0,
  fat: parseFloat(fat) || 0,
  default_unit: unit,
  barcode: parsedBarcode.barcode,
  ai_estimated: aiEstimated,
}
```

Replace raw database messages in this save path:

```ts
if (error) {
  const duplicateBarcode =
    error.code === "23505" && parsedBarcode.barcode !== null;
  setFeedback({
    type: "error",
    title: duplicateBarcode ? "Barcode already saved" : "Could not save food",
    message: duplicateBarcode
      ? "This barcode is already saved in My Foods."
      : "Please try again. Your food details are still here.",
  });
  setSubmitting(false);
  return;
}
```

- [ ] **Step 3: Render the optional field below Food Name**

Add:

```tsx
<Text style={styles.label}>Barcode number (optional)</Text>
<TextInput
  accessibilityLabel="Barcode number"
  accessibilityHint="Optional. Used to recognize this food on future scans."
  inputMode="numeric"
  keyboardType="numeric"
  maxLength={32}
  onChangeText={(value) => setBarcode(sanitizeBarcodeInput(value))}
  placeholder="e.g. 4800016123456"
  placeholderTextColor={Colors.textSecondary}
  style={styles.input}
  value={barcode}
/>
<Text style={styles.inputHelper}>
  Optional. Lets TrackBing recognize this food on future scans.
</Text>
```

Add:

```ts
inputHelper: {
  color: Colors.textSecondary,
  fontSize: 12,
  lineHeight: 17,
  marginTop: -12,
  marginBottom: 20,
},
```

- [ ] **Step 4: Run checks**

Run:

```bash
npm run typecheck
npm test -- src/lib/barcodes.test.ts src/lib/foodSearchBarcode.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add app/create-food.tsx
git diff --cached --check
git commit -m "feat: add optional barcode to personal foods"
```

### Task 5: Route scanner outcomes into personal creation

**Files:**
- Modify: `app/scan.tsx`
- Modify: `src/components/scan/ManualEntrySheet.tsx`
- Modify: `src/components/scan/NotFoundSheet.tsx`

- [ ] **Step 1: Replace the duplicate fetch with `resolveBarcode`**

In `app/scan.tsx`, import:

```ts
import { sanitizeBarcodeInput } from "@/src/lib/barcodes";
import { resolveBarcode } from "@/src/lib/foodSearch";
```

Add:

```ts
const [notFoundBarcode, setNotFoundBarcode] = useState<string | null>(null);
const [canCreateMissingFood, setCanCreateMissingFood] = useState(false);
```

Replace `processBarcode` with:

```ts
const processBarcode = async (rawCode: string) => {
  if (loading) return;
  setLoading(true);
  setManualModalVisible(false);

  const result = await resolveBarcode(rawCode);
  if (result.ok) {
    const food = result.food;
    const nutriments = food.nutriments || {};
    const initialUnit = food.default_unit || "g";
    const initialWeight =
      food.serving_quantity ||
      (initialUnit === "g" || initialUnit === "ml" ? 100 : 1);
    router.replace({
      pathname: "/(tabs)/add",
      params: {
        code: food.code,
        initialName: food.product_name || "Unknown Product",
        initialCal: nutriments["energy-kcal_100g"] || 0,
        initialProt: nutriments.proteins_100g || 0,
        initialCarbs: nutriments.carbohydrates_100g || 0,
        initialFat: nutriments.fat_100g || 0,
        brand: food.brands || "Packaged Item",
        initialWeight: String(initialWeight),
        initialUnit,
      },
    });
    return;
  }

  const barcode = sanitizeBarcodeInput(rawCode);
  setNotFoundBarcode(result.reason === "not-found" ? barcode : null);
  setCanCreateMissingFood(result.reason === "not-found");
  setNotFoundMessage(
    result.reason === "not-found"
      ? "This barcode is not in Open Food Facts or your My Foods yet."
      : result.reason === "invalid"
        ? "Use a barcode containing 4 to 32 digits."
        : result.reason === "auth-required"
          ? "Sign in again before looking up personal foods."
          : "Could not reach the food database. Check your connection and retry.",
  );
  setNotFoundModalVisible(true);
  setLoading(false);
};
```

- [ ] **Step 2: Filter manually typed barcode input**

Change the `ManualEntrySheet` call:

```tsx
onChange={(value) => setManualCode(sanitizeBarcodeInput(value))}
```

In `ManualEntrySheet.tsx`, add `maxLength={32}`,
`accessibilityLabel="Barcode number"`, and
`accessibilityHint="Enter 4 to 32 digits to look up a product"` to its
`TextInput`.

- [ ] **Step 3: Make the not-found creation action conditional**

Extend `NotFoundSheetProps`:

```ts
canCreate: boolean;
```

Add `onRequestClose={onScanAgain}` to the modal. Replace the action row with:

```tsx
<View style={styles.btnRow}>
  {canCreate ? (
    <>
      <TouchableOpacity
        accessibilityRole="button"
        style={styles.btnSecondary}
        onPress={onScanAgain}
      >
        <Text style={styles.btnSecondaryText}>Scan again</Text>
      </TouchableOpacity>
      <TouchableOpacity
        accessibilityRole="button"
        style={styles.btnPrimary}
        onPress={onCreateManually}
      >
        <Text style={styles.btnPrimaryText}>Create this food</Text>
      </TouchableOpacity>
    </>
  ) : (
    <TouchableOpacity
      accessibilityRole="button"
      style={styles.btnPrimary}
      onPress={onScanAgain}
    >
      <Text style={styles.btnPrimaryText}>Try again</Text>
    </TouchableOpacity>
  )}
</View>
```

Both existing button styles have `flex: 1` and at least 44 logical pixels of
height.

Pass from Scan:

```tsx
canCreate={canCreateMissingFood}
onCreateManually={() => {
  if (!notFoundBarcode) return;
  setNotFoundModalVisible(false);
  router.replace({
    pathname: "/create-food",
    params: { barcode: notFoundBarcode },
  });
}}
```

- [ ] **Step 4: Run checks**

Run:

```bash
npm run typecheck
npm test -- src/lib/barcodes.test.ts src/lib/foodSearchBarcode.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add app/scan.tsx src/components/scan/ManualEntrySheet.tsx src/components/scan/NotFoundSheet.tsx
git diff --cached --check
git commit -m "feat: create personal foods from unmatched barcodes"
```

### Task 6: Verify security, UI, and preserved scope

**Files:**
- Review: all files changed by this plan
- Do not modify: `app/(tabs)/cookbook.tsx`

- [ ] **Step 1: Run complete automated checks**

Run:

```bash
npm run typecheck
npm test
npm run lint
npm audit
```

Expected: typecheck, tests, and lint exit 0. Audit has no reachable critical or
high production vulnerability; document any pre-existing advisory.

- [ ] **Step 2: Run security/source gates**

Run:

```bash
rg -n 'from\\(\"personal_foods\"\\)' app src
rg -n 'eq\\(\"user_id\", user.id\\)|auth.uid\\(\\) = user_id|encodeURIComponent|parseBarcode' app/scan.tsx app/create-food.tsx src/lib/foodSearch.ts supabase/migrations/20260731000000_add_personal_food_barcodes.sql
rg -n 'Barcode number \\(optional\\)|barcode' app/'(tabs)'/cookbook.tsx
```

Expected: owner scoping, RLS, encoding, and validation are present; the final
Cookbook command returns no new barcode UI.

- [ ] **Step 3: Verify Expo web at required widths**

Start:

```bash
npm run web -- --port 8082
```

Use Playwright to verify `/create-food` at 375×812, 768×1024, and 1440×1000.
Capture:

```text
output/playwright/create-food-barcode-375.png
output/playwright/create-food-barcode-768.png
output/playwright/create-food-barcode-1440.png
```

Confirm:

- blank barcode is optional
- typed letters/punctuation are filtered
- leading zeroes remain
- invalid short value shows friendly feedback and preserves the form
- a `?barcode=00012345` route prefills the field
- no horizontal overflow or covered control
- focus order and accessible names are logical
- console has no uncaught errors

Use the scanner's manual-entry path to verify `not-found` shows
**Create this food** and an unreachable response does not. Do not write test
data to a production-like account; stop at the reviewed create form unless a
disposable local/test Supabase account is available.

- [ ] **Step 4: Review the final diff**

Run:

```bash
git diff cb3be57..HEAD -- src/lib/barcodes.ts src/lib/barcodes.test.ts src/lib/foodSearch.ts src/lib/foodSearchBarcode.test.ts app/create-food.tsx app/scan.tsx src/components/scan/ManualEntrySheet.tsx src/components/scan/NotFoundSheet.tsx supabase/migrations/20260731000000_add_personal_food_barcodes.sql
git status --short
```

Check correctness, readability, architecture, security, and performance.
Confirm no raw database error is shown, personal lookup short-circuits public
lookup, and the original Add/Cookbook/Stats changes plus `codex.diff` remain
unstaged.

- [ ] **Step 5: State the security gate**

```text
Security check: barcode scanner/route/form input is strictly validated; leading
zeroes are stored as text; external URLs are encoded; personal reads and writes
are user_id-scoped and protected by owner-only RLS; per-user duplicate storage
is blocked; raw database errors are not exposed; no secrets or anonymous write
paths were added.
```
