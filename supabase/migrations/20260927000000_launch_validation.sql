-- Additive launch guards against the public schema inspected read-only on
-- 2026-09-27. Existing invalid rows are retained: NOT VALID checks guard new
-- inserts/updates without scanning, rewriting or deleting historical records.
-- Recipes use JSONB ingredient snapshots; no recipe_items table exists.

create table if not exists public.recipes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  ingredients jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists recipes_user_id_idx on public.recipes(user_id);

-- PostgreSQL RLS does not protect TRUNCATE. Replace legacy ALL grants with
-- only the ordinary owner operations the existing app uses. Restrictive owner
-- policies also fence any older/future permissive policies without deleting them.
do $$
declare v_table text;
begin
  foreach v_table in array array['food_logs','personal_foods','user_goals','daily_summaries','recipes'] loop
    execute format('alter table public.%I enable row level security',v_table);
    execute format('revoke all on public.%I from public,anon,authenticated',v_table);
    execute format('grant select,insert,update,delete on public.%I to authenticated',v_table);
    execute format('grant all on public.%I to service_role',v_table);
    execute format('create policy launch_owner_access on public.%I for all to authenticated using(auth.uid()=user_id) with check(auth.uid()=user_id)',v_table);
    execute format('create policy launch_owner_boundary on public.%I as restrictive for all to authenticated using(auth.uid()=user_id) with check(auth.uid()=user_id)',v_table);
  end loop;
  foreach v_table in array array['ai_usage','entitlements'] loop
    execute format('alter table public.%I enable row level security',v_table);
    execute format('revoke all on public.%I from public,anon,authenticated',v_table);
    execute format('grant select on public.%I to authenticated',v_table);
    execute format('grant all on public.%I to service_role',v_table);
    execute format('create policy launch_owner_boundary on public.%I as restrictive for all to authenticated using(auth.uid()=user_id) with check(auth.uid()=user_id)',v_table);
  end loop;
end $$;

alter table public.food_logs
  add constraint launch_food_name check(length(btrim(name)) between 1 and 300 and name !~ '[[:cntrl:]]') not valid,
  add constraint launch_food_nutrition check(calories between 0 and 100000 and protein between 0 and 100000 and carbs between 0 and 100000 and fat between 0 and 100000) not valid,
  add constraint launch_food_barcode check(barcode is null or barcode ~ '^[0-9]{4,32}$') not valid,
  add constraint launch_food_serving check(serving_size is null or case
    when length(btrim(serving_size)) between 1 and 32 and btrim(serving_size) ~ '^[0-9]+([.][0-9]+)?$'
    then btrim(serving_size)::numeric > 0 and btrim(serving_size)::numeric <= 100000
    else false end) not valid,
  add constraint launch_food_unit check((serving_unit is null and serving_size is null) or (serving_unit is not null and serving_unit in ('g','ml','oz','tsp','tbsp','cup','serving','piece','bar','pack'))) not valid,
  add constraint launch_food_timestamp check(isfinite(created_at)) not valid;

alter table public.personal_foods
  add constraint launch_personal_name check(length(btrim(name)) between 1 and 300 and name !~ '[[:cntrl:]]') not valid,
  add constraint launch_personal_nutrition check(calories between 0 and 100000 and protein between 0 and 100000 and carbs between 0 and 100000 and fat between 0 and 100000) not valid,
  add constraint launch_personal_barcode check(barcode is null or barcode ~ '^[0-9]{4,32}$') not valid,
  add constraint launch_personal_unit check(default_unit is not null and default_unit in ('g','ml','oz','tsp','tbsp','cup','serving','piece','bar','pack')) not valid;

-- No new calorie floor or automatic recalculation: existing custom targets and
-- null legacy metadata keep their meaning. Bounds match current body-stat UI.
alter table public.user_goals
  add constraint launch_goal_calories check(calorie_target between 1 and 100000) not valid,
  add constraint launch_goal_stats check(
    (current_weight is null or current_weight between 30 and 300) and
    (target_weight is null or target_weight between 30 and 300) and
    (height is null or height between 100 and 250) and
    (age is null or age between 13 and 100)) not valid,
  add constraint launch_goal_profile check(
    (gender is null or gender in ('male','female')) and
    (activity_level is null or activity_level in ('1.2','1.375','1.55','1.725','sedentary','light','moderate','very_active'))) not valid,
  add constraint launch_goal_macros check(
    (protein_ratio is null or protein_ratio between 0 and 100) and
    (carbs_ratio is null or carbs_ratio between 0 and 100) and
    (fat_ratio is null or fat_ratio between 0 and 100) and
    (num_nonnulls(protein_ratio,carbs_ratio,fat_ratio) <> 3 or protein_ratio+carbs_ratio+fat_ratio=100) and
    (protein_grams is null or protein_grams between 0 and 100000) and
    (carbs_grams is null or carbs_grams between 0 and 100000) and
    (fat_grams is null or fat_grams between 0 and 100000)) not valid,
  add constraint launch_goal_metadata check(
    (goal_mode is null or goal_mode in ('estimated_rate','maintenance','custom_calories','minor_maintenance','legacy_custom')) and
    (goal_rate is null or goal_rate between -0.01 and 0.005) and
    (unit_system is null or unit_system in ('metric','imperial'))) not valid;

alter table public.daily_summaries
  add constraint launch_summary_totals check(
    (calories is null or calories between 0 and 100000000) and
    (protein is null or protein between 0 and 100000000) and
    (carbs is null or carbs between 0 and 100000000) and
    (fat is null or fat between 0 and 100000000) and
    (meal_count is null or meal_count between 0 and 100000)) not valid,
  add constraint launch_summary_date check(isfinite(date)) not valid;

alter table public.recipes
  add constraint launch_recipe_name check(length(btrim(name)) between 1 and 300 and name !~ '[[:cntrl:]]') not valid;

-- Trigger validation inspects only a new/changed snapshot; historical JSON is
-- retained. No ingredient IDs/private references are accepted by this schema.
create function public.launch_validate_recipe()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_ingredient jsonb; v_key text; v_value jsonb; v_nutriments jsonb;
begin
  if jsonb_typeof(new.ingredients) <> 'array' or length(new.ingredients::text)>256000 then
    raise exception 'Invalid recipe ingredients' using errcode='23514';
  end if;
  if jsonb_array_length(new.ingredients) not between 1 and 100 then
    raise exception 'Invalid recipe ingredients' using errcode='23514';
  end if;
  for v_ingredient in select value from jsonb_array_elements(new.ingredients) loop
    if jsonb_typeof(v_ingredient)<>'object' then raise exception 'Invalid recipe ingredient' using errcode='23514'; end if;
    if exists(select 1 from jsonb_object_keys(v_ingredient) k where k not in ('name','brands','weight','unit','default_unit','serving_weight','serving_quantity','cup_weight','nutriments'))
      or jsonb_typeof(v_ingredient->'name') is distinct from 'string'
      or length(btrim(v_ingredient->>'name')) not between 1 and 300
      or v_ingredient->>'name' ~ '[[:cntrl:]]'
      or coalesce(v_ingredient->>'unit','') not in ('g','ml','oz','tsp','tbsp','cup','serving','piece','bar','pack')
      or coalesce(v_ingredient->>'default_unit','') not in ('g','ml','oz','tsp','tbsp','cup','serving','piece','bar','pack') then
      raise exception 'Invalid recipe ingredient' using errcode='23514';
    end if;
    if v_ingredient ? 'brands' and (jsonb_typeof(v_ingredient->'brands')<>'string' or length(v_ingredient->>'brands')>300) then
      raise exception 'Invalid recipe ingredient' using errcode='23514';
    end if;
    foreach v_key in array array['weight','serving_weight','serving_quantity','cup_weight'] loop
      v_value:=v_ingredient->v_key;
      if v_key='weight' or (v_value is not null and v_value<>'null'::jsonb) then
        if jsonb_typeof(v_value) is distinct from 'number' then raise exception 'Invalid recipe amount' using errcode='23514'; end if;
        if (v_value::text)::numeric <= 0 or (v_value::text)::numeric > 100000 then raise exception 'Invalid recipe amount' using errcode='23514'; end if;
      end if;
    end loop;
    v_nutriments:=v_ingredient->'nutriments';
    if jsonb_typeof(v_nutriments) is distinct from 'object' then raise exception 'Invalid recipe nutrition' using errcode='23514'; end if;
    if exists(select 1 from jsonb_object_keys(v_nutriments) k where k not in ('energy-kcal_100g','proteins_100g','carbohydrates_100g','fat_100g')) then
      raise exception 'Invalid recipe nutrition' using errcode='23514';
    end if;
    foreach v_key in array array['energy-kcal_100g','proteins_100g','carbohydrates_100g','fat_100g'] loop
      v_value:=v_nutriments->v_key;
      if jsonb_typeof(v_value) is distinct from 'number' then raise exception 'Invalid recipe nutrition' using errcode='23514'; end if;
      if (v_value::text)::numeric not between 0 and 100000 then raise exception 'Invalid recipe nutrition' using errcode='23514'; end if;
    end loop;
  end loop;
  return new;
end $$;
revoke all on function public.launch_validate_recipe() from public,anon,authenticated;
create trigger launch_validate_recipe before insert or update of ingredients on public.recipes
  for each row execute function public.launch_validate_recipe();

-- Separate abuse counter: USDA is not a paid AI lookup and never consumes
-- ai_usage/entitlements credits. One metadata row per owner, no query storage.
create table public.usda_request_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  minute_period timestamptz not null,
  count integer not null check(count between 1 and 30)
);
alter table public.usda_request_limits enable row level security;
revoke all on public.usda_request_limits from public,anon,authenticated;
grant all on public.usda_request_limits to service_role;

create function public.reserve_usda_request(p_user uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_now timestamptz:=clock_timestamp();
  v_minute timestamptz:=date_trunc('minute',v_now at time zone 'UTC') at time zone 'UTC';
  v_count integer;
begin
  if p_user is null then return jsonb_build_object('ok',false,'error','bad_request'); end if;
  insert into public.usda_request_limits as limits(user_id,minute_period,count) values(p_user,v_minute,1)
    on conflict(user_id) do update set minute_period=excluded.minute_period,
      count=case when limits.minute_period=excluded.minute_period then limits.count+1 else 1 end
    where limits.minute_period<excluded.minute_period or (limits.minute_period=excluded.minute_period and limits.count<30)
    returning count into v_count;
  if not found then
    return jsonb_build_object('ok',false,'error','rate_limited','retry_after',greatest(1,ceil(60-extract(second from clock_timestamp()))::integer));
  end if;
  return jsonb_build_object('ok',true,'remaining',30-v_count);
end $$;
revoke all on function public.reserve_usda_request(uuid) from public,anon,authenticated;
grant execute on function public.reserve_usda_request(uuid) to service_role;
revoke all on function public.increment_ai_usage(uuid,text) from public,anon,authenticated;
grant execute on function public.increment_ai_usage(uuid,text) to service_role;
revoke all on function public.get_weekly_stats(timestamptz) from public,anon,authenticated;
grant execute on function public.get_weekly_stats(timestamptz) to authenticated,service_role;

notify pgrst,'reload schema';
