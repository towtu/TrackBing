-- AI provenance flags + entitlement/quota tables for TrackBing Pro (Plan A).
--
-- ai_estimated marks foods/logs whose macros came from the AI assistant, so the
-- "AI estimate" badge can persist. entitlements holds the Pro expiry; ai_usage
-- tracks per-period AI-lookup counts for quota enforcement.
--
-- Writes to entitlements/ai_usage happen via the service role inside edge
-- functions (service role bypasses RLS), so only SELECT policies are granted.
-- Idempotent and safe to re-run.

alter table public.personal_foods add column if not exists ai_estimated boolean not null default false;
alter table public.food_logs     add column if not exists ai_estimated boolean not null default false;

create table if not exists public.entitlements (
  user_id   uuid primary key references auth.users (id) on delete cascade,
  pro_until timestamptz
);

create table if not exists public.ai_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  period  text not null,                 -- 'YYYY-MM' (monthly) or 'YYYY-MM-DD' (daily)
  count   integer not null default 0,
  primary key (user_id, period)
);

alter table public.entitlements enable row level security;
alter table public.ai_usage     enable row level security;

drop policy if exists "own entitlements - select" on public.entitlements;
create policy "own entitlements - select" on public.entitlements
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "own ai_usage - select" on public.ai_usage;
create policy "own ai_usage - select" on public.ai_usage
  for select to authenticated using (auth.uid() = user_id);

notify pgrst, 'reload schema';
