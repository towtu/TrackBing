# Personal Food Barcode Fallback Design

**Date:** 2026-07-31
**Status:** Approved in conversation; awaiting written-spec review

## Summary

When a camera-scanned or manually typed barcode is not found in Open Food
Facts, TrackBing will let the signed-in user create the food and associate the
barcode with their private My Foods record. The Create My Food screen will
also expose the same optional barcode-number field during ordinary manual
creation. Cookbook and recipe creation remain unchanged.

## Goals

- Turn a confirmed Open Food Facts miss into a useful create-food flow.
- Preserve the scanned digits, including leading zeroes.
- Let users optionally associate a numeric barcode with any manually created
  food.
- Resolve a user's saved barcode before calling Open Food Facts on future
  scans.
- Keep every personal barcode and food owner-scoped through Supabase RLS.

## Non-goals

- Submitting products to Open Food Facts.
- Sharing user-created barcode records with other users.
- Adding a barcode field to Cookbook or recipe creation.
- Supporting QR payloads, URLs, letters, or punctuation as food barcodes.
- Replacing the existing camera scanner or manual barcode-lookup sheet.
- Guessing nutrition from the barcode when no database match exists.

## User flow

### Confirmed not-found scan

1. The scanner validates the captured value as strict digits-only text.
2. TrackBing checks the signed-in user's `personal_foods` by barcode.
3. If no personal match exists, TrackBing checks Open Food Facts.
4. If Open Food Facts confirms the product is absent, the not-found sheet
   offers **Create this food** and **Scan again**.
5. **Create this food** opens `/create-food` with the normalized barcode in
   route parameters.
6. Create My Food displays the value in an editable
   **Barcode number (optional)** field.
7. The user enters the name, serving unit, and macros. TrackBing does not infer
   or invent nutrition merely from the barcode.
8. Saving creates an owner-scoped `personal_foods` record with that barcode.
9. A future scan resolves the user's record before Open Food Facts and opens
   the normal Add Food serving/logging flow.

### Ordinary manual creation

Create My Food shows the same optional barcode field when opened from Add Food.
It starts blank, filters input to digits, and can be left empty. Helper copy
explains: “Optional. Lets TrackBing recognize this food on future scans.”

### Service-unreachable state

An Open Food Facts network or server failure is not a confirmed miss. The
scanner shows a retry-oriented error and does not label the product as absent.
The create-food fallback appears only for a true `not-found` result.

## Data model

Add a nullable `barcode text` column to `public.personal_foods`.

Database rules:

- `NULL` means the food has no associated barcode.
- Non-null values must match `^[0-9]{4,32}$`.
- A partial unique index on `(user_id, barcode)` where `barcode is not null`
  prevents one user from assigning the same barcode twice.
- Different users may independently save the same barcode.
- Existing `personal_foods` RLS remains enabled with owner-only
  `auth.uid() = user_id` policies.
- Existing rows remain valid and receive `NULL`; the migration performs no
  backfill or rewrite.

The migration is idempotent, reloads the PostgREST schema, and includes
verification queries for the column, constraint, unique index, RLS flag, and
owner policy.

## Validation boundary

Create `src/lib/barcodes.ts` as the pure source of truth:

- `sanitizeBarcodeInput(value)` removes non-digits for the editable text-field
  UX and caps the result at 32 characters.
- `parseBarcode(value, { optional })` trims and strictly validates a value
  without extracting digits from a larger QR/URL payload. It returns the
  normalized text or a user-facing validation reason.
- Leading zeroes are always retained; barcode values are never converted to
  JavaScript numbers.
- The valid persisted length is 4–32 digits so short accidental input and
  oversized scanner payloads cannot be stored.

The UI validation improves feedback; the PostgreSQL check constraint remains
the authoritative storage boundary.

## Lookup architecture

Move the scan page onto the existing `lookupBarcode` abstraction instead of
maintaining its second direct Open Food Facts fetch implementation.

Add an owner-scoped personal lookup:

```text
resolveBarcode(code)
  strictly parse and validate
  read personal_foods where user_id = auth.uid() and barcode = code
  if personal match: return it as a FoodItem
  otherwise: call encoded Open Food Facts lookup
```

The Supabase query includes `.eq("user_id", user.id)` even though RLS also
enforces ownership. Personal records take precedence so a food the user
created remains stable if Open Food Facts later adds a different entry.

Lookup results distinguish:

- `personal` — owner-created food found
- `open-food-facts` — public product found
- `not-found` — neither source has the barcode
- `unreachable` — the public service could not be checked
- `invalid` — the scan/manual value is not a supported numeric barcode
- `auth-required` — no signed-in user is available for the owner-first lookup

Only `not-found` enables **Create this food**.

## Create My Food UI

Place the barcode field directly below Food Name, before Bee's AI-fill
guidance. It uses the existing input surface, spacing, type, focus, and error
patterns:

- Label: **Barcode number (optional)**
- Placeholder: `e.g. 4800016123456`
- Numeric keyboard/input mode
- Maximum 32 digits
- Visible helper text
- Accessible label and hint
- Inline validation feedback before submission

When the route contains a valid `barcode` parameter, initialize the field with
that value. The field remains editable because the same screen also supports
ordinary manual creation and correction. Invalid route values are discarded
and surfaced through existing feedback rather than silently stored.

On duplicate barcode conflict, show a generic, actionable message:
“This barcode is already saved in My Foods.” Do not expose raw database paths,
constraint names, or stack traces.

## Error handling

- Invalid barcode: keep the form values and identify the digits/length rule.
- Duplicate for the same user: keep the form open and direct the user to My
  Foods.
- Save failure: use the existing generic SweetFeedback surface and log details
  only in development-safe diagnostics.
- Personal lookup failure: do not bypass ownership or pretend the barcode is
  absent; show a retryable lookup error.
- Open Food Facts failure: retain the current scan value for retry.
- Missing session: require sign-in before personal lookup or saving.

## Security

The barcode is untrusted scanner/user input. Editable fields sanitize as the
user types, while scanner and route values must pass strict parsing before
queries, storage, or external URLs; Open Food Facts URLs use
`encodeURIComponent`. Supabase queries remain parameterized, every personal
read/write is explicitly scoped by `user_id`, and RLS is the final
authorization boundary. Barcode data is not secret, but the associated food
record is private. No new secrets, service-role access, upload, or anonymous
write path is introduced.

## Testing and verification

### Automated

- Unit-test digit filtering, strict scanner parsing, leading-zero preservation,
  length bounds, empty optional values, and invalid QR/URL payloads.
- Unit-test resolution precedence: personal match before Open Food Facts.
- Unit-test `not-found` versus `unreachable` behavior.
- Keep existing food-search, nutrition, and Bee tests passing.
- Run `npm run typecheck`, `npm test`, and `npm run lint`.

### Browser and interaction

At 375, 768, and 1440 pixels:

- Create My Food shows an optional barcode field without horizontal overflow.
- Letters/punctuation are filtered and leading zeroes remain visible.
- A blank barcode saves through the existing manual-food path.
- A scanned not-found barcode opens Create My Food prefilled.
- Saving a valid barcode associates it with the owner-created food.
- Re-scanning resolves that personal food without an Open Food Facts request.
- A duplicate shows friendly feedback and preserves the form.
- An unreachable Open Food Facts response offers retry, not a false
  not-found/create claim.
- Cookbook and recipe surfaces have no new barcode field.
- Console and network panels show no uncaught errors, leaked details, or
  duplicate requests.

## Acceptance criteria

- Every Create My Food flow has an optional digits-only barcode field.
- Confirmed unmatched scans carry their digits into Create My Food.
- Users enter all nutrition themselves when the barcode has no match.
- Future scans resolve the owner's saved food first.
- Leading zeroes are preserved.
- Duplicate barcodes are prevented per user but allowed across different
  users.
- Open Food Facts outages are not treated as confirmed misses.
- Cookbook remains unchanged.
- The migration preserves RLS and existing data.
- Typecheck, tests, lint, security review, and responsive browser checks pass.
