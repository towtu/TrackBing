-- Isolated test database only. Relevant base columns were inspected in a
-- schema-only dump of the linked TrackBing project on 2026-09-15. The repository
-- predates migrations for these tables. Never apply this fixture to a project.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
grant usage on schema auth, public to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

create table public.food_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  name text not null,
  calories numeric not null,
  protein numeric not null,
  carbs numeric not null,
  fat numeric not null,
  barcode text,
  created_at timestamptz not null default now(),
  serving_size text,
  serving_unit text default 'g',
  ai_estimated boolean not null default false
);
create table public.daily_summaries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  date date not null,
  calories integer default 0,
  protein integer default 0,
  carbs integer default 0,
  fat integer default 0,
  meal_count integer default 0,
  created_at timestamptz default now(),
  unique(user_id, date)
);
create table public.personal_foods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  name text not null,
  calories numeric not null,
  protein numeric not null,
  carbs numeric not null,
  fat numeric not null,
  created_at timestamptz default now(),
  default_unit text default 'g',
  ai_estimated boolean not null default false
);
create table public.user_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  calorie_target integer not null,
  current_weight numeric,
  height numeric,
  age integer,
  gender text,
  activity_level text,
  created_at timestamptz default now(),
  target_weight numeric,
  protein_ratio integer default 30,
  carbs_ratio integer default 35,
  fat_ratio integer default 35,
  protein_grams integer default 150,
  carbs_grams integer default 200,
  fat_grams integer default 70,
  goal_mode text,
  goal_rate numeric,
  unit_system text
);
-- Supabase has table grants as well as RLS policies. Reproduce both boundaries.
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
