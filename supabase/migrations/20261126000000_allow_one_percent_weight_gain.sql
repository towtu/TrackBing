-- Widen the persisted weekly gain goal without changing calorie safeguards.
-- Require an adult profile for newly available rates above 0.5%.
alter table public.user_goals
  drop constraint user_goals_goal_rate_check,
  drop constraint launch_goal_metadata,
  add constraint user_goals_goal_rate_check
    check (goal_rate is null or (
      goal_rate between -0.01 and 0.01 and
      (goal_rate <= 0.005 or (age is not null and age >= 18))
    )),
  add constraint launch_goal_metadata check (
    (goal_mode is null or goal_mode in ('estimated_rate','maintenance','custom_calories','minor_maintenance','legacy_custom')) and
    (goal_rate is null or goal_rate between -0.01 and 0.01) and
    (unit_system is null or unit_system in ('metric','imperial'))
  ) not valid;

-- Keep the same owner, search path, and execution privileges for Bee reviews.
create or replace function public.adaptive_validate_goal(p_user uuid,p_goal jsonb)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.user_goals%rowtype; v_next jsonb; v_key text;
begin
  if jsonb_typeof(p_goal) is distinct from 'object' or jsonb_typeof(p_goal->'previous') is distinct from 'object' or
    jsonb_typeof(p_goal->'next') is distinct from 'object' or jsonb_typeof(p_goal->'profileRevision') is distinct from 'number' then return false; end if;
  select * into v_row from public.user_goals where user_id=p_user;
  if not found or v_row.profile_revision::numeric is distinct from (p_goal->>'profileRevision')::numeric then return false; end if;
  v_next:=p_goal->'next';
  if exists(select 1 from jsonb_object_keys(v_next) k where k not in ('calorie_target','protein_grams','carbs_grams','fat_grams','goal_mode','goal_rate','maintenance_calories','calculation_method','target_weight')) then return false; end if;
  if v_next->'target_weight' is distinct from to_jsonb(v_row)->'target_weight' then return false; end if;
  for v_key in select jsonb_object_keys(p_goal->'previous') loop
    if p_goal#>array['previous',v_key] is distinct from to_jsonb(v_row)->v_key then return false; end if;
  end loop;
  foreach v_key in array array['calorie_target','protein_grams','carbs_grams','fat_grams'] loop
    if jsonb_typeof(v_next->v_key) is distinct from 'number' or (v_next->>v_key)::numeric not between (case when v_key='calorie_target' then 1 else 0 end) and 100000 or
      (v_next->>v_key)::numeric<>trunc((v_next->>v_key)::numeric) then return false; end if;
  end loop;
  if coalesce(v_next->>'goal_mode','') not in ('estimated_rate','maintenance','custom_calories','minor_maintenance') or
    (v_next->>'goal_rate' is not null and (v_next->>'goal_rate')::numeric not between -0.01 and 0.01) or
    (v_next->>'maintenance_calories' is not null and (v_next->>'maintenance_calories')::numeric not between 1 and 100000) or
    (v_next->>'calculation_method' is not null and v_next->>'calculation_method' not in ('mifflin_st_jeor','nasem_eer_2023')) then return false; end if;
  if v_row.age is null or v_row.height is null or v_row.current_weight is null or v_row.gender is null or v_row.activity_level is null then return false; end if;
  if v_row.age<18 and (v_next->>'goal_mode'<>'minor_maintenance' or coalesce((v_next->>'goal_rate')::numeric,0)<>0 or
    v_next->>'calculation_method' is distinct from 'nasem_eer_2023' or (v_next->>'maintenance_calories')::numeric is distinct from (v_next->>'calorie_target')::numeric) then return false; end if;
  return true;
exception when others then return false;
end $$;
