-- Original TrackBing tables predate versioned migrations. The column types and
-- keys match the read-only linked-project schema inspected 2026-09-27 and the
-- isolated bee_fixture.sql. CREATE IF NOT EXISTS preserves existing production
-- tables and rows; it also lets a fresh Supabase project apply every migration.
-- Compare a live project's schema before applying this to any existing project.
create table if not exists public.food_logs (
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

create table if not exists public.daily_summaries (
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

create table if not exists public.personal_foods (
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

create table if not exists public.user_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id),
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
  fat_grams integer default 70
);

create table if not exists public.recipes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  ingredients jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists recipes_user_id_idx on public.recipes(user_id);

-- Start closed on a fresh project. The next existing migration installs owner
-- policies and the launch migration also replaces broad legacy grants.
alter table public.food_logs enable row level security;
alter table public.daily_summaries enable row level security;
alter table public.personal_foods enable row level security;
alter table public.user_goals enable row level security;
alter table public.recipes enable row level security;
