-- Adaptive Bee: dated owner measurements, typed approved actions and fresh,
-- non-grounded insights. Existing food RPC signatures and custom goals remain.
alter table public.user_goals
  add column profile_revision bigint not null default 0,
  add column maintenance_calories numeric,
  add column calculation_method text,
  add column time_zone text;
alter table public.user_goals
  add constraint adaptive_goal_maintenance check(maintenance_calories is null or maintenance_calories between 1 and 100000) not valid,
  add constraint adaptive_goal_method check(calculation_method is null or calculation_method in ('mifflin_st_jeor','nasem_eer_2023')) not valid;

alter table public.bee_pending_actions
  add column action_kind text not null default 'food' check(action_kind in ('food','weight','goal')),
  add column weight jsonb,
  add column goal jsonb,
  add column saved_action_id uuid;
alter table public.bee_pending_actions add constraint adaptive_action_payload check(
  (action_kind='food' and weight is null and goal is null) or
  (action_kind='weight' and jsonb_typeof(weight)='object' and goal is null) or
  (action_kind='goal' and jsonb_typeof(goal)='object' and weight is null));

create table public.weight_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  weight_kg numeric not null check(weight_kg between 30 and 300),
  original_amount numeric not null check(original_amount>0 and original_amount<=1000),
  unit text not null check(unit in ('kg','lb')),
  measured_at timestamptz,
  time_zone text,
  local_date date,
  is_baseline boolean not null default false,
  source text not null check(source in ('profile_baseline','profile','manual','bee')),
  bee_action_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check((is_baseline and measured_at is null and local_date is null and source='profile_baseline') or
    (not is_baseline and measured_at is not null and isfinite(measured_at) and local_date is not null)),
  foreign key(user_id,bee_action_id) references public.bee_pending_actions(user_id,id),
  unique(user_id,id), unique(user_id,bee_action_id)
);
create index weight_logs_owner_recent on public.weight_logs(user_id,measured_at desc nulls last,created_at desc,id);
create unique index weight_logs_one_baseline on public.weight_logs(user_id) where is_baseline;
alter table public.weight_logs enable row level security;
revoke all on public.weight_logs from public,anon,authenticated;
grant select on public.weight_logs to authenticated;
grant all on public.weight_logs to service_role;
create policy weight_owner_read on public.weight_logs for select to authenticated using(auth.uid()=user_id);

-- The existing single value has no known measurement date. Label it explicitly
-- rather than assigning an invented date; future measurements sort before it.
insert into public.weight_logs(user_id,weight_kg,original_amount,unit,is_baseline,source)
  select user_id,current_weight,current_weight,'kg',true,'profile_baseline'
  from public.user_goals where current_weight between 30 and 300;

create table public.bee_context_revisions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  revision bigint not null default 0 check(revision>=0)
);
create table public.profile_write_requests (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  fingerprint text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key(user_id,request_id)
);
create table public.bee_insights (
  user_id uuid primary key references auth.users(id) on delete cascade,
  context_revision bigint not null,
  local_date date not null,
  time_zone text not null,
  text text check(length(text) between 1 and 1000),
  pose text check(pose in ('greeting','thinking','encouraging','celebrating','caution','resting','searching','success')),
  expires_at timestamptz,
  request_id uuid,
  lease_token uuid,
  lease_expires_at timestamptz,
  updated_at timestamptz not null default now()
);
do $$ declare t text; begin
  foreach t in array array['bee_context_revisions','profile_write_requests','bee_insights'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant all on public.%I to service_role',t);
  end loop;
end $$;
grant select on public.bee_context_revisions,public.bee_insights to authenticated;
create policy context_owner_read on public.bee_context_revisions for select to authenticated using(auth.uid()=user_id);
create policy insight_owner_read on public.bee_insights for select to authenticated using(auth.uid()=user_id);

create function public.adaptive_bump_context()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_user uuid:=case when tg_op='DELETE' then old.user_id else new.user_id end;
begin
  insert into public.bee_context_revisions(user_id,revision) values(v_user,1)
    on conflict(user_id) do update set revision=public.bee_context_revisions.revision+1;
  -- Physically remove expired/stale generated wording rather than returning it.
  update public.bee_insights set text=null,pose=null,expires_at=null where user_id=v_user;
  return null;
end $$;
revoke all on function public.adaptive_bump_context() from public,anon,authenticated;
do $$ declare t text; begin
  foreach t in array array['food_logs','weight_logs','user_goals','bee_memories','personal_foods'] loop
    execute format('create trigger adaptive_bump_context after insert or update or delete on public.%I for each row execute function public.adaptive_bump_context()',t);
  end loop;
end $$;

create function public.adaptive_profile_revision()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.time_zone is not null and not exists(select 1 from pg_timezone_names where name=new.time_zone) then
    raise exception 'Invalid timezone' using errcode='23514';
  end if;
  new.profile_revision:=case when tg_op='INSERT' then 0 else old.profile_revision+1 end;
  return new;
end $$;
revoke all on function public.adaptive_profile_revision() from public,anon,authenticated;
create trigger adaptive_profile_revision before insert or update on public.user_goals for each row execute function public.adaptive_profile_revision();

create function public.adaptive_sync_weight()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_user uuid:=case when tg_op='DELETE' then old.user_id else new.user_id end; v_weight numeric;
begin
  select weight_kg into v_weight from public.weight_logs where user_id=v_user
    order by measured_at desc nulls last,created_at desc,id desc limit 1;
  update public.user_goals set current_weight=v_weight where user_id=v_user and current_weight is distinct from v_weight;
  return null;
end $$;
revoke all on function public.adaptive_sync_weight() from public,anon,authenticated;
create trigger adaptive_sync_weight after insert or update or delete on public.weight_logs for each row execute function public.adaptive_sync_weight();

-- Bridge old Profile clients as well as the new atomic RPC. Nested weight sync
-- updates must never produce a second measurement. Other target fields remain.
create function public.adaptive_capture_profile_weight()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_now timestamptz:=clock_timestamp(); v_zone text:=coalesce(new.time_zone,'UTC');
begin
  if pg_trigger_depth()>1 or new.current_weight is null or
    (tg_op='UPDATE' and new.current_weight is not distinct from old.current_weight) then return null; end if;
  insert into public.weight_logs(user_id,weight_kg,original_amount,unit,measured_at,time_zone,local_date,source)
    values(new.user_id,new.current_weight,new.current_weight,'kg',v_now,v_zone,(v_now at time zone v_zone)::date,'profile');
  return null;
end $$;
revoke all on function public.adaptive_capture_profile_weight() from public,anon,authenticated;
create trigger adaptive_capture_profile_weight after insert or update of current_weight on public.user_goals for each row execute function public.adaptive_capture_profile_weight();

-- Private canonical writer shared by manual check-ins and approved Bee actions.
create function public.adaptive_write_weight(p_user uuid,p_amount numeric,p_unit text,p_measured_at timestamptz,p_timezone text,p_id uuid,p_delete boolean,p_action uuid default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id uuid; v_kg numeric; v_current numeric; v_latest uuid;
begin
  if p_user is null or p_delete is null or (p_delete and p_id is null) then return jsonb_build_object('ok',false,'error','bad_request'); end if;
  perform pg_advisory_xact_lock(hashtextextended('profile:'||p_user::text,0));
  perform 1 from public.user_goals where user_id=p_user for update;
  if not p_delete then
    if p_unit is null or p_unit not in ('kg','lb') or p_amount is null or p_amount not between 0.01 and 1000
      or p_measured_at is null or not isfinite(p_measured_at) or p_measured_at>clock_timestamp()+interval '5 minutes'
      or p_timezone is null or not exists(select 1 from pg_timezone_names where name=p_timezone) then return jsonb_build_object('ok',false,'error','bad_request'); end if;
    v_kg:=case when p_unit='kg' then p_amount else p_amount/2.2046226218 end;
    if v_kg not between 30 and 300 then return jsonb_build_object('ok',false,'error','weight_out_of_range'); end if;
  end if;
  if p_id is not null then
    perform 1 from public.weight_logs where user_id=p_user and id=p_id and not is_baseline for update;
    if not found then return jsonb_build_object('ok',false,'error','not_found'); end if;
    v_id:=p_id;
    if p_delete then delete from public.weight_logs where user_id=p_user and id=p_id;
    else update public.weight_logs set weight_kg=v_kg,original_amount=p_amount,unit=p_unit,measured_at=p_measured_at,
      time_zone=p_timezone,local_date=(p_measured_at at time zone p_timezone)::date,updated_at=clock_timestamp() where user_id=p_user and id=p_id; end if;
  else
    insert into public.weight_logs(user_id,weight_kg,original_amount,unit,measured_at,time_zone,local_date,source,bee_action_id)
      values(p_user,v_kg,p_amount,p_unit,p_measured_at,p_timezone,(p_measured_at at time zone p_timezone)::date,case when p_action is null then 'manual' else 'bee' end,p_action) returning id into v_id;
  end if;
  select id,weight_kg into v_latest,v_current from public.weight_logs where user_id=p_user order by measured_at desc nulls last,created_at desc,id desc limit 1;
  return jsonb_build_object('ok',true,'id',v_id,'current_weight',v_current,'updates_current_weight',v_latest=v_id,'deleted',p_delete);
end $$;
revoke all on function public.adaptive_write_weight(uuid,numeric,text,timestamptz,text,uuid,boolean,uuid) from public,anon,authenticated;

create function public.save_weight_checkin(p_request uuid,p_amount numeric,p_unit text,p_measured_at timestamptz,p_timezone text,p_id uuid default null,p_delete boolean default false)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_user uuid:=auth.uid(); v_fingerprint text; v_prior public.profile_write_requests%rowtype; v_result jsonb;
begin
  if v_user is null or p_request is null then return jsonb_build_object('ok',false,'error','unauthorized'); end if;
  v_fingerprint:=md5(jsonb_build_array('weight',p_amount,p_unit,p_measured_at,p_timezone,p_id,p_delete)::text);
  perform pg_advisory_xact_lock(hashtextextended('profile:'||v_user::text,0));
  select * into v_prior from public.profile_write_requests where user_id=v_user and request_id=p_request;
  if found then
    if v_prior.fingerprint<>v_fingerprint then return jsonb_build_object('ok',false,'error','conflict'); end if;
    return v_prior.result;
  end if;
  v_result:=public.adaptive_write_weight(v_user,p_amount,p_unit,p_measured_at,p_timezone,p_id,p_delete);
  if v_result->>'ok'='true' then insert into public.profile_write_requests(user_id,request_id,fingerprint,result) values(v_user,p_request,v_fingerprint,v_result); end if;
  return v_result;
end $$;
revoke all on function public.save_weight_checkin(uuid,numeric,text,timestamptz,text,uuid,boolean) from public,anon,authenticated;
grant execute on function public.save_weight_checkin(uuid,numeric,text,timestamptz,text,uuid,boolean) to authenticated;

create function public.save_profile(p_request uuid,p_profile jsonb,p_expected_revision bigint default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_user uuid:=auth.uid(); v_row public.user_goals%rowtype; v_prior public.profile_write_requests%rowtype; v_fingerprint text; v_result jsonb;
begin
  if v_user is null or p_request is null then return jsonb_build_object('ok',false,'error','unauthorized'); end if;
  if jsonb_typeof(p_profile) is distinct from 'object' or length(p_profile::text)>8000 or
    exists(select 1 from jsonb_object_keys(p_profile) k where k not in ('current_weight','target_weight','height','age','gender','activity_level','calorie_target','unit_system','protein_ratio','carbs_ratio','fat_ratio','protein_grams','carbs_grams','fat_grams','goal_mode','goal_rate','maintenance_calories','calculation_method','time_zone')) then return jsonb_build_object('ok',false,'error','bad_request'); end if;
  v_fingerprint:=md5(jsonb_build_array('profile',p_profile,p_expected_revision)::text);
  perform pg_advisory_xact_lock(hashtextextended('profile:'||v_user::text,0));
  select * into v_prior from public.profile_write_requests where user_id=v_user and request_id=p_request;
  if found then
    if v_prior.fingerprint<>v_fingerprint then return jsonb_build_object('ok',false,'error','conflict'); end if;
    return v_prior.result;
  end if;
  select * into v_row from public.user_goals where user_id=v_user for update;
  if p_expected_revision is not null and (v_row.id is null or v_row.profile_revision<>p_expected_revision) then return jsonb_build_object('ok',false,'error','stale_profile'); end if;
  v_row:=jsonb_populate_record(v_row,p_profile);
  if v_row.age<18 and v_row.goal_mode is distinct from 'minor_maintenance' and
    not (v_row.goal_mode='legacy_custom' and exists(select 1 from public.user_goals where user_id=v_user and calorie_target=v_row.calorie_target and goal_mode='legacy_custom')) then return jsonb_build_object('ok',false,'error','minor_maintenance_required'); end if;
  if v_row.id is null then
    insert into public.user_goals(user_id,calorie_target,current_weight,target_weight,height,age,gender,activity_level,protein_ratio,carbs_ratio,fat_ratio,protein_grams,carbs_grams,fat_grams,goal_mode,goal_rate,unit_system,maintenance_calories,calculation_method,time_zone)
      values(v_user,v_row.calorie_target,v_row.current_weight,v_row.target_weight,v_row.height,v_row.age,v_row.gender,v_row.activity_level,coalesce(v_row.protein_ratio,25),coalesce(v_row.carbs_ratio,45),coalesce(v_row.fat_ratio,30),v_row.protein_grams,v_row.carbs_grams,v_row.fat_grams,v_row.goal_mode,v_row.goal_rate,v_row.unit_system,v_row.maintenance_calories,v_row.calculation_method,v_row.time_zone) returning * into v_row;
  else
    update public.user_goals set calorie_target=v_row.calorie_target,current_weight=v_row.current_weight,target_weight=v_row.target_weight,height=v_row.height,age=v_row.age,gender=v_row.gender,activity_level=v_row.activity_level,protein_ratio=v_row.protein_ratio,carbs_ratio=v_row.carbs_ratio,fat_ratio=v_row.fat_ratio,protein_grams=v_row.protein_grams,carbs_grams=v_row.carbs_grams,fat_grams=v_row.fat_grams,goal_mode=v_row.goal_mode,goal_rate=v_row.goal_rate,unit_system=v_row.unit_system,maintenance_calories=v_row.maintenance_calories,calculation_method=v_row.calculation_method,time_zone=v_row.time_zone where user_id=v_user returning * into v_row;
  end if;
  v_result:=jsonb_build_object('ok',true,'profile',to_jsonb(v_row)-'user_id');
  insert into public.profile_write_requests(user_id,request_id,fingerprint,result) values(v_user,p_request,v_fingerprint,v_result);
  return v_result;
exception when check_violation or not_null_violation or invalid_text_representation or numeric_value_out_of_range then return jsonb_build_object('ok',false,'error','bad_request');
end $$;
revoke all on function public.save_profile(uuid,jsonb,bigint) from public,anon,authenticated;
grant execute on function public.save_profile(uuid,jsonb,bigint) to authenticated;

create function public.adaptive_validate_weight(p_user uuid,p_weight jsonb,p_timezone text)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare v_kg numeric; v_at timestamptz; v_latest timestamptz; v_updates boolean;
begin
  if jsonb_typeof(p_weight) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_weight) k where k not in ('weightKg','originalAmount','unit','measuredAt','localDate','timeZone','updatesCurrentWeight')) or
    jsonb_typeof(p_weight->'weightKg') is distinct from 'number' or jsonb_typeof(p_weight->'originalAmount') is distinct from 'number' or
    jsonb_typeof(p_weight->'updatesCurrentWeight') is distinct from 'boolean' or coalesce(p_weight->>'unit','') not in ('kg','lb') or
    p_weight->>'timeZone' is distinct from p_timezone then return false; end if;
  v_kg:=case when p_weight->>'unit'='kg' then (p_weight->>'originalAmount')::numeric else (p_weight->>'originalAmount')::numeric/2.2046226218 end;
  v_at:=(p_weight->>'measuredAt')::timestamptz;
  if v_kg not between 30 and 300 or abs(v_kg-(p_weight->>'weightKg')::numeric)>0.000001 or v_at is null or not isfinite(v_at) or
    v_at>clock_timestamp()+interval '5 minutes' or (v_at at time zone p_timezone)::date::text is distinct from p_weight->>'localDate' then return false; end if;
  select max(measured_at) into v_latest from public.weight_logs where user_id=p_user;
  v_updates:=exists(select 1 from public.user_goals where user_id=p_user) and (v_latest is null or v_at>=v_latest);
  return v_updates=(p_weight->>'updatesCurrentWeight')::boolean;
exception when others then return false;
end $$;
revoke all on function public.adaptive_validate_weight(uuid,jsonb,text) from public,anon,authenticated;

create function public.adaptive_validate_goal(p_user uuid,p_goal jsonb)
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
    (v_next->>'goal_rate' is not null and (v_next->>'goal_rate')::numeric not between -0.01 and 0.005) or
    (v_next->>'maintenance_calories' is not null and (v_next->>'maintenance_calories')::numeric not between 1 and 100000) or
    (v_next->>'calculation_method' is not null and v_next->>'calculation_method' not in ('mifflin_st_jeor','nasem_eer_2023')) then return false; end if;
  if v_row.age is null or v_row.height is null or v_row.current_weight is null or v_row.gender is null or v_row.activity_level is null then return false; end if;
  if v_row.age<18 and (v_next->>'goal_mode'<>'minor_maintenance' or coalesce((v_next->>'goal_rate')::numeric,0)<>0 or
    v_next->>'calculation_method' is distinct from 'nasem_eer_2023' or (v_next->>'maintenance_calories')::numeric is distinct from (v_next->>'calorie_target')::numeric) then return false; end if;
  return true;
exception when others then return false;
end $$;
revoke all on function public.adaptive_validate_goal(uuid,jsonb) from public,anon,authenticated;


create or replace function public.bee_prune_history(p_user uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_threads uuid[];
  v_now timestamptz := clock_timestamp();
begin
  if p_user is null then raise exception 'Owner required' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('bee:' || p_user::text, 0));
  with removed as (
    delete from public.bee_messages where user_id = p_user and id in (
      select id from (
        select id, created_at, row_number() over(partition by thread_id order by created_at desc,id desc) as position
        from public.bee_messages where user_id = p_user
      ) m where created_at < v_now - interval '30 days' or position > 50
    ) returning thread_id
  ) select array_agg(distinct thread_id) into v_threads from removed;
  -- Every cached snapshot may include content that was removed. Discard its
  -- completed replay, preserving the currently leased turn during finishing.
  with removed as (
    delete from public.bee_turns where user_id = p_user
      and (created_at < v_now - interval '30 days' or thread_id = any(v_threads))
      and (status <> 'running' or lease_expires_at <= v_now)
    returning request_id
  ) update public.ai_lookup_reservations set result = null
    where user_id = p_user and request_id in (select request_id from removed);
  update public.bee_threads t set state = '{}'::jsonb
    where t.user_id = p_user and t.updated_at < v_now - interval '30 days'
      and (t.lease_expires_at is null or t.lease_expires_at <= v_now)
      and not exists(select 1 from public.bee_messages m where m.user_id = p_user and m.thread_id = t.id);
  delete from public.bee_pending_actions a where a.user_id = p_user and a.created_at < v_now - interval '30 days'
    and not exists(select 1 from public.bee_messages m where m.user_id = p_user and m.action_id = a.id)
    and not exists(select 1 from public.food_logs f where f.user_id = p_user and f.bee_action_id = a.id)
    and not exists(select 1 from public.weight_logs w where w.user_id = p_user and w.bee_action_id = a.id);
  -- Core reservation results can contain independently sourced food context.
  -- Retain only the accounting row after the chat retention period.
  update public.ai_lookup_reservations set result = null where user_id = p_user and created_at < v_now - interval '30 days';
  update public.bee_insights set text=null,pose=null,expires_at=null where user_id=p_user and expires_at<=v_now;
end $$;

create or replace function public.bee_snapshot(p_user uuid, p_thread uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.bee_prune_history(p_user);
  return (select jsonb_build_object(
    'thread', jsonb_build_object('id', t.id, 'version', t.version),
    'messages', coalesce((
      select jsonb_agg(m.payload order by m.created_at, m.id) from (
        select m.id, m.created_at,
          jsonb_build_object('id', m.id, 'role', m.role, 'text', m.text, 'created_at', m.created_at) ||
          case when a.id is null then '{}'::jsonb else jsonb_build_object('draft',
            (to_jsonb(a) - 'user_id' - 'saved_log_id' - 'created_at' - 'action_kind' - 'saved_action_id') || jsonb_build_object('kind',a.action_kind)) end as payload
        from public.bee_messages m
        left join public.bee_pending_actions a on a.user_id = p_user and a.thread_id = p_thread and a.id = m.action_id
        where m.user_id = p_user and m.thread_id = p_thread
        order by m.created_at desc, m.id desc limit 50
      ) m
    ), '[]'::jsonb),
    'memories', coalesce((select jsonb_agg(jsonb_build_object('key', key, 'value', value, 'source', source, 'created_at', created_at, 'updated_at', updated_at) order by key)
      from public.bee_memories where user_id = p_user), '[]'::jsonb),
    'profile', coalesce((select jsonb_build_object(
      'calorie_target', calorie_target, 'protein_grams', protein_grams, 'carbs_grams', carbs_grams,
      'fat_grams', fat_grams, 'current_weight', current_weight, 'target_weight', target_weight,
      'height', height, 'age', age, 'gender', gender, 'activity_level', activity_level,
      'protein_ratio',protein_ratio,'carbs_ratio',carbs_ratio,'fat_ratio',fat_ratio,'unit_system', unit_system, 'goal_mode', goal_mode,'goal_rate',goal_rate,'profile_revision',profile_revision,
      'maintenance_calories',maintenance_calories,'calculation_method',calculation_method,'time_zone',time_zone
    ) from public.user_goals where user_id = p_user order by created_at desc limit 1), '{}'::jsonb),
    'suggested_pose',coalesce(t.state->>'suggested_pose','greeting'),
    'pending', (select (to_jsonb(a) - 'user_id' - 'saved_log_id' - 'created_at' - 'action_kind' - 'saved_action_id') || jsonb_build_object('kind',a.action_kind) from public.bee_pending_actions a
      where a.user_id = p_user and a.thread_id = p_thread and a.status = 'pending')
  ) from public.bee_threads t where t.user_id = p_user and t.id = p_thread);
end
$$;

create or replace function public.bee_begin_turn(
  p_user uuid, p_thread uuid, p_request uuid, p_fingerprint text,
  p_expected_version integer, p_timezone text, p_command jsonb
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_thread public.bee_threads%rowtype;
  v_turn public.bee_turns%rowtype;
  v_token uuid := gen_random_uuid();
  v_now timestamptz := clock_timestamp();
  v_kind text := p_command->>'kind';
  v_state jsonb;
  v_pending jsonb;
  v_result jsonb;
  v_decision boolean;
begin
  if p_user is null or p_request is null or p_fingerprint is null or length(p_fingerprint) not between 1 and 256
    or p_timezone is null or not exists(select 1 from pg_timezone_names where name = p_timezone)
    or jsonb_typeof(p_command) is distinct from 'object'
    or length(p_command::text) > 8000
    or v_kind is null or v_kind not in ('load','new_thread','clear_chat','message','food_assist','insight','confirm','cancel','memory_set','memory_delete','memory_clear') then
    return jsonb_build_object('ok',false,'error','bad_request');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('bee:' || p_user::text, 0));
  perform public.bee_prune_history(p_user);
  select * into v_turn from public.bee_turns where user_id = p_user and request_id = p_request for update;
  if found then
    if v_turn.fingerprint <> p_fingerprint or (p_thread is not null and p_thread <> v_turn.thread_id and v_turn.command->>'kind' <> 'new_thread') then
      return jsonb_build_object('ok',false,'error','conflict');
    end if;
    if v_turn.status = 'completed' then
      return jsonb_build_object('ok',true,'replay',true,'result',v_turn.result);
    end if;
    select * into v_thread from public.bee_threads where user_id = p_user and id = v_turn.thread_id for update;
    if v_thread.version <> v_turn.base_version then
      return jsonb_build_object('ok',false,'error','conflict');
    end if;
    if v_thread.lease_expires_at > v_now then
      return jsonb_build_object('ok',false,'error','busy');
    end if;
    update public.bee_turns set status = 'running', lease_token = v_token,
      lease_expires_at = v_now + interval '90 seconds', updated_at = v_now, result = null
      where user_id = p_user and request_id = p_request;
    update public.bee_threads set lease_request = p_request, lease_token = v_token,
      lease_expires_at = v_now + interval '90 seconds' where user_id = p_user and id = v_thread.id;
    return jsonb_build_object('ok',true,'replay',false,'thread_id',v_thread.id,
      'version',v_thread.version,'token',v_token,'state',v_turn.context_state,'pending',v_turn.context_pending);
  end if;

  if p_thread is not null then
    select * into v_thread from public.bee_threads where user_id = p_user and id = p_thread for update;
    if not found then return jsonb_build_object('ok',false,'error','not_found'); end if;
  elsif v_kind <> 'new_thread' then
    select * into v_thread from public.bee_threads where user_id = p_user order by updated_at desc, id desc limit 1 for update;
  end if;
  if v_thread.id is null or v_kind = 'new_thread' then
    insert into public.bee_threads(user_id) values(p_user) returning * into v_thread;
  end if;
  if v_thread.lease_expires_at > v_now and v_kind <> 'load' then
    return jsonb_build_object('ok',false,'error','busy');
  end if;
  if p_expected_version is not null and p_expected_version <> v_thread.version and v_kind not in ('load','new_thread') then
    return jsonb_build_object('ok',false,'error','conflict');
  end if;
  if v_kind in ('load','new_thread') then
    v_result := jsonb_build_object('ok',true,'snapshot',public.bee_snapshot(p_user,v_thread.id));
    insert into public.bee_turns(user_id,request_id,thread_id,fingerprint,command,time_zone,base_version,status,result)
      values(p_user,p_request,v_thread.id,p_fingerprint,p_command,p_timezone,v_thread.version,'completed',v_result);
    return jsonb_build_object('ok',true,'replay',true,'result',v_result);
  end if;
  v_state := v_thread.state;
  select (to_jsonb(a) - 'user_id' - 'saved_log_id' - 'created_at' - 'action_kind' - 'saved_action_id') || jsonb_build_object('kind',a.action_kind) into v_pending
    from public.bee_pending_actions a where a.user_id = p_user and a.thread_id = v_thread.id and a.status = 'pending';
  v_decision := v_kind in ('confirm','cancel') or (v_kind in ('message','food_assist')
    and lower(regexp_replace(btrim(p_command->>'text'), '[.!]+$', '')) ~ '^(yes|yep|yeah|add( it)?|add to today|log it|save it|confirm|go ahead|no|nope|cancel|never mind|nevermind|don''t add( it)?|do not add( it)?)$'
    and p_command ? 'actionId' and p_command ? 'reviewVersion' and v_state->>'awaiting' = 'review');
  if (v_kind in ('confirm','cancel') or (v_kind in ('message','food_assist') and p_command ? 'actionId')) and (
      v_pending is null or v_pending->>'id' <> p_command->>'actionId'
      or v_pending->>'review_version' <> p_command->>'reviewVersion') then
    return jsonb_build_object('ok',false,'error','stale_action');
  end if;
  -- Interrupting a review changes state at acquisition. An abandoned edit must
  -- not leave the old Add button usable after its worker lease expires.
  if not coalesce(v_decision,false) and v_pending is not null and v_kind <> 'insight' then
    update public.bee_pending_actions set status = 'superseded'
      where user_id = p_user and thread_id = v_thread.id and status = 'pending';
    update public.bee_threads set version = version + 1,
      state = jsonb_set(state,'{awaiting}','"none"'), updated_at = v_now
      where user_id = p_user and id = v_thread.id returning * into v_thread;
  end if;
  insert into public.bee_turns(user_id,request_id,thread_id,fingerprint,command,time_zone,base_version,context_state,context_pending,status,lease_token,lease_expires_at)
    values(p_user,p_request,v_thread.id,p_fingerprint,p_command,p_timezone,v_thread.version,v_state,v_pending,'running',v_token,v_now + interval '90 seconds');
  update public.bee_threads set lease_request = p_request, lease_token = v_token, lease_expires_at = v_now + interval '90 seconds'
    where user_id = p_user and id = v_thread.id;
  return jsonb_build_object('ok',true,'replay',false,'thread_id',v_thread.id,'version',v_thread.version,
    'state',v_state,'pending',v_pending,'token',v_token);
end $$;

create or replace function public.bee_finish_turn(p_user uuid,p_thread uuid,p_request uuid,p_token uuid,p_outcome jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_thread public.bee_threads%rowtype;
  v_turn public.bee_turns%rowtype;
  v_action public.bee_pending_actions%rowtype;
  v_now timestamptz := clock_timestamp();
  v_kind text;
  v_confirm boolean;
  v_cancel boolean;
  v_error text := p_outcome->>'error';
  v_text text := p_outcome->>'text';
  v_food jsonb := p_outcome->'draft';
  v_weight jsonb:=p_outcome->'weight_draft';
  v_goal jsonb:=p_outcome->'goal_draft';
  v_saved jsonb; v_write jsonb; v_pose text:=p_outcome->>'suggested_pose';
  v_action_kind text;
  v_state jsonb;
  v_memory jsonb := p_outcome->'memory';
  v_log_id text;
  v_warning boolean := false;
  v_result jsonb;
  v_retryable boolean;
begin
  if p_token is null or jsonb_typeof(p_outcome) is distinct from 'object' or length(p_outcome::text) > 50000
    or public.bee_contains_grounding(p_outcome) then
    return jsonb_build_object('ok',false,'error','bad_request');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('bee:' || p_user::text, 0));
  select * into v_thread from public.bee_threads where user_id = p_user and id = p_thread for update;
  if not found then return jsonb_build_object('ok',false,'error','not_found'); end if;
  select * into v_turn from public.bee_turns where user_id = p_user and thread_id = p_thread and request_id = p_request for update;
  if not found then return jsonb_build_object('ok',false,'error','not_found'); end if;
  if v_turn.status = 'completed' then return v_turn.result; end if;
  if v_turn.status <> 'running' or v_turn.lease_token is distinct from p_token
    or v_thread.lease_token is distinct from p_token or v_thread.lease_request is distinct from p_request
    or v_thread.lease_expires_at <= v_now or v_turn.base_version <> v_thread.version then
    return jsonb_build_object('ok',false,'error','conflict');
  end if;
  v_kind := v_turn.command->>'kind';
  v_state := coalesce(p_outcome->'state',v_thread.state);
  if v_pose is not null then
    if v_pose not in ('greeting','thinking','encouraging','celebrating','caution','resting','searching','success') then v_error:='bad_request';
    else v_state:=jsonb_set(v_state,'{suggested_pose}',to_jsonb(v_pose)); end if;
  end if;
  if jsonb_typeof(v_state) is distinct from 'object' or length(coalesce(v_text,'')) > 4000 then
    v_error := 'bad_request';
  end if;
  v_confirm := v_kind = 'confirm' or (v_kind in ('message','food_assist') and p_outcome->>'confirm' = 'true'
    and v_turn.context_state->>'awaiting' = 'review'
    and lower(regexp_replace(btrim(v_turn.command->>'text'), '[.!]+$', '')) ~ '^(yes|yep|yeah|add( it)?|add to today|log it|save it|confirm|go ahead)$');
  v_cancel := v_kind = 'cancel' or (v_kind in ('message','food_assist') and p_outcome->>'cancel' = 'true'
    and v_turn.context_state->>'awaiting' = 'review'
    and lower(regexp_replace(btrim(v_turn.command->>'text'), '[.!]+$', '')) ~ '^(no|nope|cancel|never mind|nevermind|don''t add( it)?|do not add( it)?)$');
  if v_error is null and (coalesce(v_confirm,false) or coalesce(v_cancel,false)) then
    select * into v_action from public.bee_pending_actions
      where user_id = p_user and thread_id = p_thread and id::text = v_turn.command->>'actionId' for update;
    if not found or v_action.status <> 'pending' or v_action.review_version::text is distinct from v_turn.command->>'reviewVersion' then
      v_error := 'stale_action';
    -- A different confirmation timezone requires a fresh review of "today",
    -- even when both zones currently have the same calendar date. Completed
    -- request retries already returned their original result above.
    elsif v_action.expires_at <= v_now or ((v_action.action_kind='food' or (v_action.action_kind='weight' and v_action.local_date=(v_action.created_at at time zone v_action.time_zone)::date)) and (v_now at time zone v_action.time_zone)::date <> v_action.local_date)
      or (coalesce(v_confirm,false) and v_turn.time_zone is distinct from v_action.time_zone) then
      update public.bee_pending_actions set status = 'expired' where user_id = p_user and id = v_action.id;
      update public.bee_threads set version = version + 1, state = jsonb_set(state,'{awaiting}','"none"')
        where user_id = p_user and id = p_thread;
      v_error := 'expired';
    elsif coalesce(v_confirm,false) and ((v_action.action_kind='weight' and not public.adaptive_validate_weight(p_user,v_action.weight,v_turn.time_zone)) or
      (v_action.action_kind='goal' and not public.adaptive_validate_goal(p_user,v_action.goal))) then
      update public.bee_pending_actions set status='superseded' where user_id=p_user and id=v_action.id;
      v_error:='stale_profile';
    elsif coalesce(v_cancel,false) then
      update public.bee_pending_actions set status = 'cancelled' where user_id = p_user and id = v_action.id;
      v_state := jsonb_set(v_state,'{awaiting}','"none"');
      v_text := coalesce(v_text,'Cancelled.');
    else
      -- The reviewed snapshot is the only input to a log. No client/model macros
      -- are accepted by this branch. Exception subtransaction preserves pending
      -- state if insertion fails, allowing the SAME request to retry safely.
      begin
        if v_action.action_kind='food' then
        insert into public.food_logs(user_id,name,calories,protein,carbs,fat,serving_size,serving_unit,ai_estimated,created_at,bee_action_id,bee_provenance)
          values(p_user,v_action.food->>'name',(v_action.food->>'calories')::numeric,
            (v_action.food->>'protein')::numeric,(v_action.food->>'carbs')::numeric,(v_action.food->>'fat')::numeric,
            v_action.food#>>'{portion,amount}',v_action.food#>>'{portion,unit}',v_action.food->>'source' = 'ai_estimate',v_now,v_action.id,
            jsonb_build_object('food',v_action.food,'local_date',v_action.local_date,'time_zone',v_action.time_zone,'review_version',v_action.review_version))
          returning id::text into v_log_id;
        update public.bee_pending_actions set status = 'confirmed', saved_log_id = v_log_id
          where user_id = p_user and id = v_action.id;
        else
          perform pg_advisory_xact_lock(hashtextextended('profile:'||p_user::text,0));
          if v_action.action_kind='weight' then
            v_write:=public.adaptive_write_weight(p_user,(v_action.weight->>'originalAmount')::numeric,v_action.weight->>'unit',
              (v_action.weight->>'measuredAt')::timestamptz,v_action.time_zone,null,false,v_action.id);
            if v_write->>'ok'<>'true' then raise exception 'Weight save failed'; end if;
            v_log_id:=v_write->>'id';
          else
            update public.user_goals set calorie_target=(v_action.goal#>>'{next,calorie_target}')::integer,
              protein_grams=(v_action.goal#>>'{next,protein_grams}')::integer,carbs_grams=(v_action.goal#>>'{next,carbs_grams}')::integer,
              fat_grams=(v_action.goal#>>'{next,fat_grams}')::integer,goal_mode=v_action.goal#>>'{next,goal_mode}',goal_rate=(v_action.goal#>>'{next,goal_rate}')::numeric,
              maintenance_calories=(v_action.goal#>>'{next,maintenance_calories}')::numeric,calculation_method=v_action.goal#>>'{next,calculation_method}'
              where user_id=p_user and profile_revision=(v_action.goal->>'profileRevision')::bigint returning id::text into v_log_id;
            if v_log_id is null then raise exception 'Goal save failed'; end if;
          end if;
          update public.bee_pending_actions set status='confirmed',saved_action_id=v_log_id::uuid where user_id=p_user and id=v_action.id;
        end if;
        v_saved:=jsonb_build_object('kind',v_action.action_kind,'id',v_log_id,'pending_id',v_action.id,'local_date',v_action.local_date);
      exception when others then
        v_error := 'save_failed';
      end;
      if v_error is null then
        v_state := jsonb_set(v_state,'{awaiting}','"none"');
        v_text := coalesce(v_text,case when v_action.action_kind='food' then 'Added to your food log.' when v_action.action_kind='weight' then 'Weight recorded.' else 'Goal updated.' end);
        if v_action.action_kind='food' then
        -- A summary is derived data: preserve the authoritative food log even if
        -- recomputation fails. The client receives an explicit warning.
        begin
          insert into public.daily_summaries(user_id,date,calories,protein,carbs,fat,meal_count)
            select p_user,v_action.local_date,round(coalesce(sum(calories),0)),round(coalesce(sum(protein),0)),
              round(coalesce(sum(carbs),0)),round(coalesce(sum(fat),0)),count(*)
            from public.food_logs where user_id = p_user
              and created_at >= (v_action.local_date::timestamp at time zone v_action.time_zone)
              and created_at < ((v_action.local_date + 1)::timestamp at time zone v_action.time_zone)
            on conflict(user_id,date) do update set calories=excluded.calories,protein=excluded.protein,
              carbs=excluded.carbs,fat=excluded.fat,meal_count=excluded.meal_count;
        exception when others then v_warning := true;
        end;
        end if;
      end if;
    end if;
  end if;
  if v_error is null then
    if v_kind = 'clear_chat' then
      delete from public.bee_messages where user_id = p_user and thread_id = p_thread;
      with removed as (
        delete from public.bee_turns where user_id = p_user and thread_id = p_thread and request_id <> p_request returning request_id
      ) update public.ai_lookup_reservations set result = null
        where user_id = p_user and request_id in (select request_id from removed);
      delete from public.bee_pending_actions a where user_id = p_user and thread_id = p_thread
        and not exists(select 1 from public.food_logs f where f.user_id = p_user and f.bee_action_id = a.id)
    and not exists(select 1 from public.weight_logs w where w.user_id = p_user and w.bee_action_id = a.id);
      v_state := '{}'::jsonb;
      v_food := null; v_weight:=null; v_goal:=null;
      v_memory := null;
      v_text := null;
    elsif v_kind = 'memory_clear' then
      delete from public.bee_memories where user_id = p_user;
      -- Do not let a previous load or memory-turn replay restore forgotten
      -- values. Fence other in-flight threads before they can save old context.
      delete from public.bee_turns where user_id = p_user and request_id <> p_request;
      update public.ai_lookup_reservations set result = null where user_id = p_user;
      update public.bee_threads set state = state - 'memory' - 'memories',version = version + 1,
        lease_request = null,lease_token = null,lease_expires_at = null
        where user_id = p_user and id <> p_thread;
      v_state := v_state - 'memory' - 'memories';
      v_memory := null;
      v_food := null; v_weight:=null; v_goal:=null;
    end if;
    if v_kind in ('memory_set','memory_delete') then
      v_memory := jsonb_build_object('kind',case when v_kind='memory_set' then 'set' else 'delete' end,
        'key',v_turn.command->>'key','value',v_turn.command->>'value');
    end if;
    if v_memory is not null and v_memory <> 'null'::jsonb then
      if coalesce(v_memory->>'key','') not in ('preferred_name','preferred_units','usual_product','usual_preparation')
        or coalesce(v_memory->>'kind','') not in ('set','delete') then
        raise exception 'Invalid memory operation' using errcode = '22023';
      end if;
      if v_memory->>'kind' = 'delete' then
        delete from public.bee_memories where user_id = p_user and key = v_memory->>'key';
      else
        insert into public.bee_memories(user_id,key,value) values(p_user,v_memory->>'key',v_memory->>'value')
          on conflict(user_id,key) do update set value=excluded.value,updated_at=v_now;
      end if;
    end if;
    if p_outcome->>'invalidate_pending' = 'true' or (v_food is not null and v_food <> 'null'::jsonb) or (v_weight is not null and v_weight<>'null'::jsonb) or (v_goal is not null and v_goal<>'null'::jsonb) then
      update public.bee_pending_actions set status = 'superseded'
        where user_id = p_user and thread_id = p_thread and status = 'pending';
    end if;
    if v_food is not null and v_food <> 'null'::jsonb then
      -- Backend evidence validation is stricter; this is a final numeric/type
      -- boundary so a broken internal caller cannot persist an unusable draft.
      if jsonb_typeof(v_food) <> 'object' or length(coalesce(v_food->>'name','')) not between 1 and 300
        or (v_food->>'grams')::numeric not between 0.01 and 20000
        or (v_food->>'calories')::numeric not between 0 and 100000
        or (v_food->>'protein')::numeric not between 0 and 20000
        or (v_food->>'carbs')::numeric not between 0 and 20000
        or (v_food->>'fat')::numeric not between 0 and 20000
        or exists(select 1 from unnest(array['calories','protein','carbs','fat']) k where jsonb_typeof(v_food->k) is distinct from 'number')
        or not coalesce((
          jsonb_typeof(v_food->'grams') = 'number'
          or (v_food->'grams' = 'null'::jsonb and v_food#>'{evidence,basis,grams}' = 'null'::jsonb
            and v_food#>>'{portion,unit}' = v_food#>>'{evidence,basis,unit}'
            and (
              (v_food#>>'{portion,unit}' = 'ml' and jsonb_typeof(v_food#>'{evidence,basis,milliliters}') = 'number'
                and (v_food#>>'{evidence,basis,milliliters}')::numeric between 0.01 and 20000)
              or (v_food#>>'{portion,unit}' in ('cup','piece','bar','serving','pack')
                and jsonb_typeof(v_food#>'{evidence,basis,count}') = 'number'
                and (v_food#>>'{evidence,basis,count}')::numeric between 0.01 and 20000)
            ))
        ),false)
        or jsonb_typeof(v_food->'portion') is distinct from 'object'
        or jsonb_typeof(v_food#>'{portion,amount}') is distinct from 'number'
        or (v_food#>>'{portion,amount}')::numeric not between 0.01 and 20000
        or coalesce(v_food#>>'{portion,unit}','') not in ('g','oz','ml','cup','piece','bar','serving','pack')
        or jsonb_typeof(v_food->'query') is distinct from 'object'
        or jsonb_typeof(v_food->'evidence') is distinct from 'object'
        or coalesce(v_food#>>'{evidence,record}','') not in ('independent','user_owned')
        or length(coalesce(v_food->>'servingLabel','')) not between 1 and 200
        or coalesce(v_food->>'source','') not in ('web','usda','openfoodfacts','my_food','user_label','ai_estimate') then
        raise exception 'Invalid reviewed food' using errcode = '22023';
      end if;
      insert into public.bee_pending_actions(user_id,thread_id,review_version,food,local_date,time_zone,expires_at)
        values(p_user,p_thread,v_thread.version+1,v_food,(v_now at time zone v_turn.time_zone)::date,v_turn.time_zone,
          least(v_now + interval '30 minutes',(((v_now at time zone v_turn.time_zone)::date + 1)::timestamp at time zone v_turn.time_zone)))
        returning * into v_action;
      v_state := jsonb_set(v_state,'{awaiting}','"review"');
    end if;
    if v_weight is not null and v_weight<>'null'::jsonb or v_goal is not null and v_goal<>'null'::jsonb then
      if v_food is not null and v_food<>'null'::jsonb or (v_weight is not null and v_weight<>'null'::jsonb and v_goal is not null and v_goal<>'null'::jsonb) then raise exception 'Ambiguous action'; end if;
      v_action_kind:=case when v_weight is not null and v_weight<>'null'::jsonb then 'weight' else 'goal' end;
      if (v_action_kind='weight' and not public.adaptive_validate_weight(p_user,v_weight,v_turn.time_zone)) or
        (v_action_kind='goal' and not public.adaptive_validate_goal(p_user,v_goal)) then raise exception 'Invalid reviewed action' using errcode='22023'; end if;
      insert into public.bee_pending_actions(user_id,thread_id,review_version,food,action_kind,weight,goal,local_date,time_zone,expires_at)
        values(p_user,p_thread,v_thread.version+1,'{}'::jsonb,v_action_kind,v_weight,v_goal,
          case when v_action_kind='weight' then (v_weight->>'localDate')::date else (v_now at time zone v_turn.time_zone)::date end,
          v_turn.time_zone,least(v_now+interval '30 minutes',(((v_now at time zone v_turn.time_zone)::date+1)::timestamp at time zone v_turn.time_zone))) returning * into v_action;
      v_state:=jsonb_set(v_state,'{awaiting}','"review"');
    end if;
    if v_kind in ('message','food_assist') then
      insert into public.bee_messages(user_id,thread_id,role,text) values(p_user,p_thread,'user',v_turn.command->>'text');
    end if;
    if coalesce(length(v_text),0) > 0 then
      insert into public.bee_messages(user_id,thread_id,role,text,action_id,data)
        values(p_user,p_thread,'assistant',v_text,
          case when (v_food is not null and v_food <> 'null'::jsonb) or v_action_kind is not null then v_action.id else null end,
          case when (v_food is not null and v_food <> 'null'::jsonb) or v_action_kind is not null then jsonb_build_object('kind',coalesce(v_action_kind,'food')||'_review') else '{}'::jsonb end);
    end if;
    update public.bee_threads set state=case when v_kind='insight' then state else v_state end,version=version+case when v_kind='insight' then 0 else 1 end,updated_at=v_now
      where user_id=p_user and id=p_thread;
    v_result := jsonb_build_object('ok',true,'snapshot',public.bee_snapshot(p_user,p_thread) ||
      case when v_saved is null then '{}'::jsonb else jsonb_build_object('saved_action',v_saved) || case when v_saved->>'kind'='food' then jsonb_build_object('saved_log_id',v_log_id,'summary_warning',v_warning) else '{}'::jsonb end end);
  else
    v_result := jsonb_build_object('ok',false,'error',v_error);
  end if;
  v_retryable := v_error in ('provider_unavailable','not_configured','save_failed','error','rate_limited','over_free_quota','over_pro_cap');
  update public.bee_turns set status=case when coalesce(v_retryable,false) then 'failed' else 'completed' end,
    result=v_result,lease_expires_at=null,updated_at=v_now
    where user_id=p_user and request_id=p_request and thread_id=p_thread;
  update public.bee_threads set lease_token=null,lease_request=null,lease_expires_at=null
    where user_id=p_user and id=p_thread;
  return v_result;
end $$;
