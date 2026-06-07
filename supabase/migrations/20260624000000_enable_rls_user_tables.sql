-- Enforce owner-only Row Level Security on every user-owned table.
--
-- Each of these tables has a `user_id` column referencing auth.users. Without
-- RLS, the public anon key (which ships in the client bundle) can read and
-- write any row. These policies restrict access to the authenticated owner.
--
-- Idempotent and defensive: skips any table that lacks a `user_id` column so a
-- schema mismatch warns instead of aborting the whole migration. Safe to re-run.

do $$
declare
  t text;
  user_tables text[] := array[
    'food_logs',
    'daily_summaries',
    'personal_foods',
    'user_goals'
  ];
begin
  foreach t in array user_tables loop
    if not exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = t
        and column_name = 'user_id'
    ) then
      raise warning 'Skipping %.%: no user_id column found', 'public', t;
      continue;
    end if;

    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists "Users manage own rows" on public.%I;', t);
    execute format(
      'create policy "Users manage own rows" on public.%I
         for all
         to authenticated
         using (auth.uid() = user_id)
         with check (auth.uid() = user_id);',
      t
    );
  end loop;
end $$;
