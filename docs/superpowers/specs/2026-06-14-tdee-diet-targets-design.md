# TrackBing TDEE and Diet Target Design

**Date:** 2026-06-14
**Status:** Approved for implementation planning

## Goal

Give TrackBing users a defensible starting calorie target, support metric and
imperial editing, prevent universally aggressive calorie adjustments, and keep
signup, profile editing, dashboard overrides, and stored goals consistent.

This release provides an initial estimate. It does not claim to infer a user's
true energy expenditure from longitudinal intake and weight data.

## Current-State Audit

The original summary is directionally correct but contains important errors and
omissions:

- The Mifflin-St Jeor equation must include `-5 * age`. The summary's displayed
  formula omitted that term.
- Mifflin-St Jeor estimates resting energy expenditure, not directly measured
  TDEE. TrackBing then applies an activity multiplier, which adds another layer
  of estimation.
- A fixed `-1000 kcal/day` adjustment is not an appropriate universal "lose
  fast" target. It can be excessive for smaller or less active users.
- A single `1200 kcal/day` floor for everyone is inconsistent with the
  sex-specific minimums currently described by MyFitnessPal.
- A calorie target should be presented as an estimate and starting point, not a
  guaranteed rate of weight change.

The working tree already contains an uncommitted draft that extracts TDEE math
into `src/lib/macros.ts`, introduces body-weight percentage goal rates, and adds
metric/imperial fields in `ProfileScreen.tsx`. That draft is useful direction
but is incomplete:

- `ProfileScreen.tsx` currently fails TypeScript because styles used by the
  custom-rate controls are missing.
- Signup still accepts metric inputs only.
- The selected rate and unit system are not persisted.
- Profile loading infers the selected rate from `calorie_target`. Floors and
  caps make that inference unreliable.
- Dashboard calorie editing accepts targets as low as 500 kcal/day.
- Signup does not initialize macro ratios and grams consistently.

## Product Scope

### Included

- Reliable static starting targets.
- Separate adult and minor calculation paths.
- Adult loss, maintenance, gain, and custom-calorie modes.
- Visible Metric/Imperial toggle in Profile -> Edit Diet.
- Metric/imperial support during signup.
- Transparent target breakdown and safety explanations.
- Persistent goal intent rather than back-calculated intent.
- Shared pure calculation utilities and focused automated tests.

### Excluded

- MacroFactor-style adaptive expenditure estimation.
- Daily weight logging and weight-trend modeling.
- Automatic weekly target adjustment.
- Exercise calorie syncing or wearable integration.
- Pregnancy, lactation, eating-disorder treatment, or clinician-managed
  nutrition calculations.

Adaptive TDEE requires consistent food intake and weight history over time.
TrackBing currently has food history but no daily weight-history model, so
shipping an "adaptive" label now would be misleading.

## Calculation Architecture

Create `src/lib/nutritionTargets.ts` as the single source of truth for body
stats, maintenance estimates, goal adjustments, calorie safeguards, macro
conversion, and unit conversion.

`src/lib/macros.ts` remains responsible for food-serving and recipe macro math.
Separating these domains prevents the file from mixing food composition with
body-energy planning.

All calculation functions are pure and return both the final result and the
intermediate values needed by the UI.

### Core Types

```ts
type BiologicalSex = "male" | "female";
type UnitSystem = "metric" | "imperial";
type ActivityLevel = "sedentary" | "light" | "moderate" | "very_active";
type GoalMode =
  | "estimated_rate"
  | "maintenance"
  | "custom_calories"
  | "minor_maintenance"
  | "legacy_custom";

type NutritionTargetResult = {
  maintenanceCalories: number;
  requestedRate: number | null;
  requestedAdjustment: number;
  appliedAdjustment: number;
  finalCalories: number;
  floorApplied: boolean;
  adjustmentCapApplied: boolean;
  calculationMethod: "mifflin_st_jeor" | "nasem_eer_2023";
};
```

The rate is stored as a signed fraction of current body weight per week. For
example, `-0.005` means losing 0.5% of body weight per week.

## Adult Targets

Adults are users age 18 or older.

### Maintenance Estimate

TrackBing continues using Mifflin-St Jeor for the adult starting estimate:

```text
Male REE   = 10W + 6.25H - 5A + 5
Female REE = 10W + 6.25H - 5A - 161

Estimated maintenance = REE * activity multiplier
```

Where:

- `W` is weight in kilograms.
- `H` is height in centimeters.
- `A` is age in years.

Activity multipliers remain:

| Level | Multiplier |
|---|---:|
| Sedentary | 1.2 |
| Light | 1.375 |
| Moderate | 1.55 |
| Very active | 1.725 |

The UI copy must describe total average routine, including purposeful exercise,
because TrackBing does not separately add exercise calories.

### Adult Presets

Loss presets:

| Label | Weekly rate |
|---|---:|
| Lose slowly | -0.25% body weight |
| Lose | -0.50% body weight |
| Lose faster | -0.75% body weight |

Gain presets:

| Label | Weekly rate |
|---|---:|
| Gain slowly | +0.10% body weight |
| Gain | +0.25% body weight |
| Gain faster | +0.50% body weight |

Maintenance uses a 0% rate.

Custom loss rates accept 0.25% through 1.0% body weight per week. Custom gain
rates accept 0.1% through 0.5% body weight per week.

### Rate-to-Calorie Conversion

```text
requested weekly change kg = current weight kg * weekly rate
requested daily adjustment = requested weekly change kg * 7700 / 7
```

The `7700 kcal/kg` conversion is only a planning approximation. The UI must not
promise that the calculated rate will occur exactly or linearly.

### Adult Safety Rules

Loss applies the least aggressive of:

1. The rate-derived deficit.
2. 30% of estimated maintenance calories.
3. 1000 kcal/day.

Gain applies the least aggressive of:

1. The rate-derived surplus.
2. 500 kcal/day.

The final adult target retains these minimums:

| Sex | Minimum target |
|---|---:|
| Female | 1200 kcal/day |
| Male | 1500 kcal/day |

The 1000 kcal figure is therefore an upper deficit limit, not a default target.
If a cap or floor changes the requested plan, the result records the reason and
the UI explains it.

## Minor Targets

Users age 13 through 17 remain supported.

They receive maintenance-only targets using the 2023 National Academies
Estimated Energy Requirement equations for children and adolescents. These
equations use age, height, weight, sex, activity category, and the energy cost
of growth.

The implementation uses the sex-specific equations from Table 5-15 of the
National Academies report. The base equation is the same for the 3-13.99 and
14-18.99 groups. The age-specific energy cost of growth differs: a 13-year-old
adds 25 kcal/day for boys or 30 kcal/day for girls; users age 14-17 add
20 kcal/day:

```text
Age 13 boys:
Inactive    = -447.51 + 3.68A + 13.01H + 13.15W + 25
Low active  =   19.12 + 3.68A +  8.62H + 20.28W + 25
Active      = -388.19 + 3.68A + 12.66H + 20.46W + 25
Very active = -671.75 + 3.68A + 15.38H + 23.25W + 25

Age 13 girls:
Inactive    =   55.59 - 22.25A +  8.43H + 17.07W + 30
Low active  = -297.54 - 22.25A + 12.77H + 14.73W + 30
Active      = -189.55 - 22.25A + 11.74H + 18.34W + 30
Very active = -709.59 - 22.25A + 18.22H + 14.25W + 30

Age 14-17 boys:
Inactive    = -447.51 + 3.68A + 13.01H + 13.15W + 20
Low active  =   19.12 + 3.68A +  8.62H + 20.28W + 20
Active      = -388.19 + 3.68A + 12.66H + 20.46W + 20
Very active = -671.75 + 3.68A + 15.38H + 23.25W + 20

Age 14-17 girls:
Inactive    =   55.59 - 22.25A +  8.43H + 17.07W + 20
Low active  = -297.54 - 22.25A + 12.77H + 14.73W + 20
Active      = -189.55 - 22.25A + 11.74H + 18.34W + 20
Very active = -709.59 - 22.25A + 18.22H + 14.25W + 20
```

Where age is years, height is centimeters, and weight is kilograms.

For minors:

- Loss and gain presets are hidden.
- Custom calorie targets are unavailable.
- The goal card displays "Maintain for healthy growth."
- The screen explains that children and teens often need individualized growth
  assessment and that weight-change plans require a health professional.

TrackBing does not use adult BMI cutoffs or adult deficit guidance for minors.

## Metric and Imperial UX

The approved design is a visible segmented control inside the Body Stats card:

```text
[ Metric (kg/cm) | Imperial (lb/ft) ]
```

Metric fields:

- Current weight in kilograms.
- Target weight in kilograms.
- Height in centimeters.

Imperial fields:

- Current weight in pounds.
- Target weight in pounds.
- Height as separate feet and inches inputs.

Age and sex do not change with unit system.

Canonical state and database values remain kilograms and centimeters.
Switching units changes display values without changing the underlying physical
measurement. Repeated toggling must not accumulate conversion drift.

The same unit choice is offered during signup. `unit_system` is persisted as a
display preference so Profile opens in the user's last selected system.

## Edit Diet UX

The feature lives in Profile -> Edit Diet, implemented by
`src/screens/ProfileScreen.tsx`.

The goal card shows:

- Estimated maintenance calories.
- Requested weekly rate as both percentage and kg/lb per week.
- Requested calorie adjustment.
- Applied calorie adjustment.
- Final daily calorie target.
- A neutral explanation when a floor or cap was applied.

Example:

```text
Estimated maintenance        2,515 kcal
Selected rate                -0.50% / week (-0.35 kg)
Requested adjustment         -385 kcal/day
Applied adjustment           -385 kcal/day
Daily target                  2,130 kcal
```

The language remains informational. TrackBing does not shame users for missing
or exceeding targets and does not describe the estimate as guaranteed.

## Macro Targets

Macro grams are always recalculated from the final calorie target using
4 kcal/g for protein, 4 kcal/g for carbohydrate, and 9 kcal/g for fat.

Signup initializes ratios and grams instead of relying on dashboard fallbacks.
The default ratio becomes:

| Macro | Default |
|---|---:|
| Protein | 25% |
| Carbohydrate | 45% |
| Fat | 30% |

This default stays within the Acceptable Macronutrient Distribution Ranges for
adults and adolescents. It is a general default, not an individualized macro
prescription. Users can edit the split, and saving requires exactly 100%.

## Persistence

Add nullable metadata columns to `user_goals`:

```sql
goal_mode text
goal_rate numeric
unit_system text
```

Allowed `goal_mode` values are:

- `estimated_rate`
- `maintenance`
- `custom_calories`
- `minor_maintenance`
- `legacy_custom`

Allowed `unit_system` values are `metric` and `imperial`.

The existing canonical columns remain unchanged:

- `current_weight` in kilograms.
- `target_weight` in kilograms.
- `height` in centimeters.
- `calorie_target` in kcal/day.
- Macro ratios as whole percentages.
- Macro targets as grams.

### Legacy Rows

The migration does not rewrite existing targets.

When a row has no `goal_mode`:

- Preserve its saved `calorie_target`.
- Load it as `legacy_custom`.
- Display "Existing custom target."
- Do not infer a rate from the target.
- Convert it to a new explicit mode only after the user selects and saves a new
  plan.

This prevents floors, caps, manual overrides, and old formulas from causing the
wrong goal chip to appear selected.

### Dashboard Override

The dashboard's direct calorie editor remains available for adult profiles and
is relabeled "Custom calorie target."

Saving it:

- Enforces the adult sex-specific floor.
- Sets `goal_mode = custom_calories`.
- Clears `goal_rate`.
- Recalculates macro grams from the stored ratios.

It is unavailable for minor profiles.

## Unsupported Conditions

The calculator is not intended to prescribe targets for:

- Pregnancy.
- Breastfeeding.
- Eating-disorder treatment or recovery.
- Clinician-managed medical nutrition therapy.
- Conditions or medications that materially affect energy needs.

The UI provides a short notice directing these users to a clinician or
registered dietitian. TrackBing may store an adult clinician-provided custom
target, but does not calculate that target.

## Validation

Shared validation rules are used by signup and profile editing:

- Age: 13-100.
- Weight: 30-300 kg or equivalent display value.
- Height: 100-250 cm or equivalent display value.
- Imperial inches field: 0-11.
- All required values must be finite positive numbers.
- Adult custom loss rate: 0.25%-1.0% per week.
- Adult custom gain rate: 0.1%-0.5% per week.
- Macro ratios must total exactly 100%.

Validation messages use the active unit system.

## Error Handling

- Calculation functions reject invalid inputs rather than returning `NaN`.
- A failed profile fetch leaves the current form untouched and shows an error.
- A failed save does not show the success modal.
- Signup does not advance when target calculation fails.
- Supabase errors are surfaced to the user instead of only logged.

## Testing

### Pure Calculation Tests

Cover:

- Male and female Mifflin-St Jeor examples.
- Every adult activity multiplier.
- Loss presets and custom rate bounds.
- 30% TDEE loss cap.
- 1000 kcal/day loss cap.
- 500 kcal/day gain cap.
- Female and male calorie floors.
- Minor male and female EER equations for each activity category.
- Age boundary behavior at 13, 14, 17, and 18.
- Metric/imperial round trips.
- Feet/inches normalization and rejection of inches above 11.
- Macro conversion and 100% validation.
- Legacy custom-target loading.

### UI Verification

Verify on mobile and desktop web:

- Signup in metric and imperial.
- Adult loss, maintenance, gain, and custom-calorie flows.
- Minor maintenance-only flow.
- Profile reload restores unit system and exact selected goal mode.
- Floor and cap explanations.
- Dashboard custom target persistence.
- Macro grams update after calorie or ratio changes.

### Required Quality Gates

- TypeScript passes with `npx tsc --noEmit`.
- Expo lint completes without new warnings.
- Production web export succeeds.
- Calculation tests pass.

## Rollout

1. Add calculation tests and the shared nutrition-target module.
2. Add the non-destructive Supabase migration.
3. Update signup to use shared adult/minor calculations and both unit systems.
4. Update Profile -> Edit Diet and persist explicit goal metadata.
5. Update dashboard custom-calorie behavior.
6. Verify legacy profiles before testing newly saved profiles.

No automatic recalculation runs for existing users during migration.

## Sources

- Mifflin MD, et al. "A new predictive equation for resting energy expenditure
  in healthy individuals." *American Journal of Clinical Nutrition* (1990):
  https://pubmed.ncbi.nlm.nih.gov/2305711/
- National Academies, *Dietary Reference Intakes for Energy* (2023), Chapter 5,
  Tables 5-5 and 5-15:
  https://www.nationalacademies.org/read/26818/chapter/7
- USDA DRI Calculator:
  https://www.nal.usda.gov/human-nutrition-and-food-safety/dri-calculator
- NIDDK guidance for children and teens:
  https://www.niddk.nih.gov/health-information/weight-management/helping-your-child-who-is-overweight
- CDC gradual weight-loss guidance:
  https://www.cdc.gov/healthy-weight-growth/losing-weight/index.html
- MyFitnessPal initial-goal and minimum-calorie behavior:
  https://support.myfitnesspal.com/hc/en-us/articles/360032625391-How-does-MyFitnessPal-calculate-my-initial-goals
- MyFitnessPal current calorie and macro explanation:
  https://support.myfitnesspal.com/hc/en-us/articles/360032625931-Nutrition-101-Calories
- MyFitnessPal Macro Calculator:
  https://support.myfitnesspal.com/hc/en-us/articles/24763932864397-Macro-Calculator
- MacroFactor algorithm overview:
  https://macrofactor.com/macrofactors-algorithms-and-core-philosophy/
- MacroFactor cutting-rate discussion:
  https://macrofactor.com/cutting-calculator/
- MacroFactor bulking-rate discussion:
  https://macrofactor.com/bulking-calculator/
