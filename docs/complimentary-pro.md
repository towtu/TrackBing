# Complimentary Pro access

An operator can give a verified adult account Pro access without charging it or
inventing a payment receipt. This is separate from paid subscriptions and the
seven-day private Bee evaluation. It uses the normal Pro monthly limits from
[plan access](plan-access.md): 250 requests, 50 Search queries, 30 insights and
800,000 input / 200,000 output tokens. It does not mean unlimited provider use.

## Security and accounting

`pro_access_grants` contains one grant per owner, its start/optional expiry,
operator reason and revocation timestamp. Owner-only RLS permits reading. Neither
anonymous nor authenticated clients can mutate grants or call the grant/revoke
functions. Even the service role writes through those restricted functions.
Functions use a fixed search path, fully qualified tables and the existing
per-owner billing lock. No new endpoint, provider secret or checkout is added.
This follows Supabase's [function privilege guidance](https://supabase.com/docs/guides/database/functions#function-privileges)
and [RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security).

Paid Pro takes precedence. A valid gift can upgrade Basic/Plus; its expiry or
revocation restores the real paid plan or a still-valid private evaluation.
Existing subscriptions, receipts, diaries and goals are unchanged. Extending or
retrying a grant preserves the billing anchor, usage and active reservations.
An ongoing gift cannot accidentally be shortened by a finite retry; revoke it
first to deliberately replace its terms.

A new billing account reuses the evaluation's start when present, so granting
Pro does not erase evaluation usage. If a previous billing anchor conflicts
with an active evaluation's used period, the grant fails with
`preview usage period mismatch`. Resolve that accounting conflict explicitly;
do not delete usage or reset the anchor to get around it.

## Apply and grant

Run the full checks first. Apply all existing migrations in order through
`20261019000100_pro_search_policy.sql`, then
`20261019000200_complimentary_pro.sql` (migration 18). This migration seeds no
accounts and changes no one's plan by itself.

```sh
supabase db push --linked --dry-run
supabase db push --linked
```

Privately verify the exact sign-in email and account UUID in Supabase Auth.
Confirm the intended duration. The RPC also requires a confirmed email and an
adult profile; never create a new identity or guess an email to match a nickname.
Use the SQL editor or an ignored, mode-600 SQL file with the linked CLI. Replace
the UUID and date below; these placeholders must not be run literally:

```sql
select public.grant_complimentary_pro(
  '<verified-account-uuid>'::uuid,
  '<approved-expiry-ISO-timestamp>'::timestamptz,
  'Operator-approved complimentary Pro'
);
```

Pass SQL `null` for expiry only when ongoing access was explicitly requested.
Check the returned `tier`, `access_mode`, `access_expires_at`, `period`, `limits`
and `remaining`. Do not equate a successful SQL command with a verified grant
unless those fields match the intended account and duration. Keep account
identifiers and email addresses out of commits and public reports.

The deployed new Bee and label functions resolve entitlements fresh on each
request, so the migration/grant does not require changing API keys or redeploying
them. Rebuild the client for the “Pro · complimentary access” label. Close/reopen
Bee or reload the app to refresh its snapshot. Plans uses the billing status
endpoint and still requires that endpoint's separate release/setup; this grant
does not deploy payments. The public old `ai-food`/`usda-search` pair remains a
separate coordinated cutover. Public release gates remain in force.

## Revoke / recover

```sql
select public.revoke_complimentary_pro('<verified-account-uuid>'::uuid);
```

Revocation retains the grant record and usage, does not touch payment records or
food/weight history, and returns the remaining actual entitlement. It cannot
cancel a paid subscription. Repeating it is safe. Do not drop additive tables
or roll back to an older resolver that could accidentally restore Plus Search.

## Verification

`npm run test:db` exercises the actual migration/RLS/functions in disposable
PostgreSQL: no client self-grants or cross-account reads, verified adult checks,
expiry/revocation, paid precedence, retry/extension without allowance reset,
in-flight reservations, incompatible-period rejection and concurrent last-slot
limits. The grant test uses synthetic accounts and receipts only in that isolated
database. `node scripts/check-label-photo-ui.cjs` checks the complimentary label
in Bee/Plans at 375, 768 and 1440 px with controlled network fixtures.

Local code verification is separate from applying a real account grant. Never
report an account upgrade before the verified target and duration are known and
the database result has been checked.

On 19 October 2026, 978 tests / 64 files, frontend and seven function typechecks,
lint, the full PostgreSQL suite (all 18 migrations), 17 Deno handler tests, web
export/finalizer and the three-width controlled browser checks passed. The
staged secret scan and focused security review found no new issues. The linked
database dry run listed only migration 18; it was **not applied** and no real
account grant was made. The requested account identity and duration remained
unconfirmed. Public release blockers in the launch guides are unchanged.
