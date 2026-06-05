-- Recipes: a named combination of ingredients. Ingredients are stored as a
-- JSONB array because a recipe is always loaded as a whole, and each ingredient
-- snapshots its own macros so the recipe survives changes to external sources.
--
-- Run this once in the Supabase SQL editor.

create table if not exists public.recipes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  ingredients jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists recipes_user_id_idx on public.recipes (user_id);

alter table public.recipes enable row level security;

drop policy if exists "Users manage own recipes" on public.recipes;
create policy "Users manage own recipes" on public.recipes
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
