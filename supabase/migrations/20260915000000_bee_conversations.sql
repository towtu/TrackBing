-- Bee server-owned conversation state. Additive to the inspected TrackBing
-- schema; food_logs keeps its existing primary key and timestamps.
create table public.bee_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  version integer not null default 0 check (version >= 0),
  state jsonb not null default '{}'::jsonb check (jsonb_typeof(state) = 'object'),
  lease_request uuid,
  lease_token uuid,
  lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, id)
);
create index bee_threads_owner_recent on public.bee_threads(user_id, updated_at desc, id);

create table public.bee_pending_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  thread_id uuid not null,
  review_version integer not null check (review_version >= 1),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'cancelled', 'superseded', 'expired')),
  food jsonb not null check (jsonb_typeof(food) = 'object'),
  local_date date not null,
  time_zone text not null,
  expires_at timestamptz not null,
  saved_log_id text,
  created_at timestamptz not null default now(),
  foreign key (user_id, thread_id) references public.bee_threads(user_id, id) on delete cascade,
  unique(user_id, id)
);
create unique index bee_one_pending_per_thread on public.bee_pending_actions(user_id, thread_id) where status = 'pending';
create index bee_pending_thread on public.bee_pending_actions(user_id, thread_id, created_at);

create table public.bee_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  thread_id uuid not null,
  role text not null check (role in ('user', 'assistant')),
  text text not null check (length(text) between 1 and 4000),
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  action_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (user_id, thread_id) references public.bee_threads(user_id, id) on delete cascade,
  foreign key (user_id, action_id) references public.bee_pending_actions(user_id, id),
  unique(user_id, id)
);
create index bee_messages_thread on public.bee_messages(user_id, thread_id, created_at, id);

create table public.bee_memories (
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null check (key in ('preferred_name', 'preferred_units', 'usual_product', 'usual_preparation')),
  value text not null check (length(value) between 1 and 200),
  source text not null default 'explicit' check (source = 'explicit'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

create table public.bee_turns (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  thread_id uuid not null,
  fingerprint text not null check (length(fingerprint) between 1 and 256),
  command jsonb not null check (jsonb_typeof(command) = 'object'),
  time_zone text not null,
  base_version integer not null,
  context_state jsonb not null default '{}'::jsonb,
  context_pending jsonb,
  status text not null check (status in ('running', 'completed', 'failed')),
  lease_token uuid,
  lease_expires_at timestamptz,
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, request_id),
  foreign key (user_id, thread_id) references public.bee_threads(user_id, id) on delete cascade
);
create index bee_turns_thread on public.bee_turns(user_id, thread_id, created_at);

alter table public.food_logs add column bee_action_id uuid;
alter table public.food_logs add column bee_provenance jsonb;
create unique index food_logs_bee_action_unique on public.food_logs(bee_action_id) where bee_action_id is not null;
create index if not exists food_logs_owner_created on public.food_logs(user_id, created_at);
alter table public.food_logs add constraint food_logs_bee_action_owner
  foreign key(user_id, bee_action_id) references public.bee_pending_actions(user_id, id);

-- Existing clients may still create/edit ordinary food logs. They cannot forge
-- Bee confirmation provenance through that otherwise legitimate write path.
-- This immutable provenance records the original review. It is historical
-- evidence, not verification of nutrition values after an owner edits the log.
create function public.guard_bee_log_provenance()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if current_user in ('anon','authenticated') then
    if (tg_op = 'INSERT' and (new.bee_action_id is not null or new.bee_provenance is not null))
      or (tg_op = 'UPDATE' and (new.bee_action_id is distinct from old.bee_action_id
        or new.bee_provenance is distinct from old.bee_provenance)) then
      raise exception 'Bee provenance is server-owned' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.guard_bee_log_provenance() from public,anon,authenticated;
create trigger guard_bee_log_provenance before insert or update on public.food_logs
  for each row execute function public.guard_bee_log_provenance();

-- Reservations count in ai_usage before providers run; failures refund monthly
-- and daily counts, never minute attempts. Keys are shared by both AI endpoints.
create table public.ai_lookup_reservations (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  fingerprint text not null check (length(fingerprint) between 1 and 256),
  status text not null check (status in ('reserved', 'completed', 'released')),
  lease_token uuid not null,
  expires_at timestamptz not null,
  month_period text not null,
  day_period text not null,
  result jsonb,
  created_at timestamptz not null default now(),
  primary key(user_id, request_id)
);
create index ai_lookup_reservations_expiry on public.ai_lookup_reservations(user_id, expires_at) where status = 'reserved';

-- This is launch accounting, not a Grounded Results cache. Reserve before
-- Google runs; costs from launched requests never refund. A replay must not
-- launch another search. Query counts are numeric provider usage metadata only.
create table public.ai_search_reservations (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  lease_token uuid not null,
  day_period text not null,
  query_count integer check (query_count between 0 and 100),
  created_at timestamptz not null default now(),
  primary key(user_id, request_id)
);
create index ai_search_reservations_day on public.ai_search_reservations(user_id, day_period);

do $$
declare t text;
begin
  foreach t in array array['bee_threads','bee_messages','bee_pending_actions','bee_memories','bee_turns','ai_lookup_reservations','ai_search_reservations'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('create policy owner_select on public.%I for select to authenticated using (auth.uid() = user_id)', t);
  end loop;
end $$;

-- Run on every conversation read/write. Delete content, including replay
-- snapshots, rather than hiding it with a SELECT filter. An hourly service-role
-- maintenance call can run this for inactive owners as well.
create function public.bee_prune_history(p_user uuid)
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
    and not exists(select 1 from public.food_logs f where f.user_id = p_user and f.bee_action_id = a.id);
  -- Core reservation results can contain independently sourced food context.
  -- Retain only the accounting row after the chat retention period.
  update public.ai_lookup_reservations set result = null where user_id = p_user and created_at < v_now - interval '30 days';
end $$;

-- Hourly maintenance also prunes users who do not open Bee again. Metadata
-- accounting rows remain, but contain no provider answer or chat text.
create function public.bee_prune_all_history()
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid;
begin
  for v_user in select user_id from public.bee_threads
    union select user_id from public.ai_lookup_reservations where result is not null
  loop
    perform public.bee_prune_history(v_user);
  end loop;
end $$;

-- A defensive storage boundary for display-only Google payloads. The provider
-- layer strips these before calling any RPC; this also rejects accidental
-- nesting in state or a quota replay payload from a future internal caller.
create function public.bee_contains_grounding(p_payload jsonb)
returns boolean language sql immutable set search_path = public, pg_temp as $$
  with recursive nodes(value) as (
    select p_payload
    union all
    select child.value from nodes n cross join lateral (
      select value from jsonb_each(case when jsonb_typeof(n.value) = 'object' then n.value else '{}'::jsonb end)
      union all
      select value from jsonb_array_elements(case when jsonb_typeof(n.value) = 'array' then n.value else '[]'::jsonb end)
    ) child
  ) select exists(select 1 from nodes where jsonb_typeof(value) = 'object' and (
    value ?| array['liveAnswer','groundedAnswer','citations','searchSuggestionsHtml','searchQueries','groundingMetadata','webSearchQueries']
  ));
$$;

-- Fixed search paths and explicit owner filters also apply under service role.
create function public.bee_snapshot(p_user uuid, p_thread uuid)
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
            to_jsonb(a) - 'user_id' - 'saved_log_id' - 'created_at') end as payload
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
      'unit_system', unit_system, 'goal_mode', goal_mode
    ) from public.user_goals where user_id = p_user order by created_at desc limit 1), '{}'::jsonb),
    'pending', (select to_jsonb(a) - 'user_id' - 'saved_log_id' - 'created_at' from public.bee_pending_actions a
      where a.user_id = p_user and a.thread_id = p_thread and a.status = 'pending')
  ) from public.bee_threads t where t.user_id = p_user and t.id = p_thread);
end
$$;

create function public.bee_begin_turn(
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
    or v_kind is null or v_kind not in ('load','new_thread','clear_chat','message','confirm','cancel','memory_set','memory_delete','memory_clear') then
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
  select to_jsonb(a) - 'user_id' - 'saved_log_id' - 'created_at' into v_pending
    from public.bee_pending_actions a where a.user_id = p_user and a.thread_id = v_thread.id and a.status = 'pending';
  v_decision := v_kind in ('confirm','cancel') or (v_kind = 'message'
    and lower(regexp_replace(btrim(p_command->>'text'), '[.!]+$', '')) ~ '^(yes|yep|yeah|add( it)?|add to today|log it|save it|confirm|go ahead|no|nope|cancel|never mind|nevermind|don''t add( it)?|do not add( it)?)$'
    and p_command ? 'actionId' and p_command ? 'reviewVersion' and v_state->>'awaiting' = 'review');
  if (v_kind in ('confirm','cancel') or (v_kind = 'message' and p_command ? 'actionId')) and (
      v_pending is null or v_pending->>'id' <> p_command->>'actionId'
      or v_pending->>'review_version' <> p_command->>'reviewVersion') then
    return jsonb_build_object('ok',false,'error','stale_action');
  end if;
  -- Interrupting a review changes state at acquisition. An abandoned edit must
  -- not leave the old Add button usable after its worker lease expires.
  if not coalesce(v_decision,false) and v_pending is not null then
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

create function public.bee_finish_turn(p_user uuid,p_thread uuid,p_request uuid,p_token uuid,p_outcome jsonb)
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
  if jsonb_typeof(v_state) is distinct from 'object' or length(coalesce(v_text,'')) > 4000 then
    v_error := 'bad_request';
  end if;
  v_confirm := v_kind = 'confirm' or (v_kind = 'message' and p_outcome->>'confirm' = 'true'
    and v_turn.context_state->>'awaiting' = 'review'
    and lower(regexp_replace(btrim(v_turn.command->>'text'), '[.!]+$', '')) ~ '^(yes|yep|yeah|add( it)?|add to today|log it|save it|confirm|go ahead)$');
  v_cancel := v_kind = 'cancel' or (v_kind = 'message' and p_outcome->>'cancel' = 'true'
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
    elsif v_action.expires_at <= v_now or (v_now at time zone v_action.time_zone)::date <> v_action.local_date
      or (coalesce(v_confirm,false) and v_turn.time_zone is distinct from v_action.time_zone) then
      update public.bee_pending_actions set status = 'expired' where user_id = p_user and id = v_action.id;
      update public.bee_threads set version = version + 1, state = jsonb_set(state,'{awaiting}','"none"')
        where user_id = p_user and id = p_thread;
      v_error := 'expired';
    elsif coalesce(v_cancel,false) then
      update public.bee_pending_actions set status = 'cancelled' where user_id = p_user and id = v_action.id;
      v_state := jsonb_set(v_state,'{awaiting}','"none"');
      v_text := coalesce(v_text,'Cancelled.');
    else
      -- The reviewed snapshot is the only input to a log. No client/model macros
      -- are accepted by this branch. Exception subtransaction preserves pending
      -- state if insertion fails, allowing the SAME request to retry safely.
      begin
        insert into public.food_logs(user_id,name,calories,protein,carbs,fat,serving_size,serving_unit,ai_estimated,created_at,bee_action_id,bee_provenance)
          values(p_user,v_action.food->>'name',(v_action.food->>'calories')::numeric,
            (v_action.food->>'protein')::numeric,(v_action.food->>'carbs')::numeric,(v_action.food->>'fat')::numeric,
            v_action.food#>>'{portion,amount}',v_action.food#>>'{portion,unit}',v_action.food->>'source' = 'ai_estimate',v_now,v_action.id,
            jsonb_build_object('food',v_action.food,'local_date',v_action.local_date,'time_zone',v_action.time_zone,'review_version',v_action.review_version))
          returning id::text into v_log_id;
        update public.bee_pending_actions set status = 'confirmed', saved_log_id = v_log_id
          where user_id = p_user and id = v_action.id;
      exception when others then
        v_error := 'save_failed';
      end;
      if v_error is null then
        v_state := jsonb_set(v_state,'{awaiting}','"none"');
        v_text := coalesce(v_text,'Added to your food log.');
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
  if v_error is null then
    if v_kind = 'clear_chat' then
      delete from public.bee_messages where user_id = p_user and thread_id = p_thread;
      with removed as (
        delete from public.bee_turns where user_id = p_user and thread_id = p_thread and request_id <> p_request returning request_id
      ) update public.ai_lookup_reservations set result = null
        where user_id = p_user and request_id in (select request_id from removed);
      delete from public.bee_pending_actions a where user_id = p_user and thread_id = p_thread
        and not exists(select 1 from public.food_logs f where f.user_id = p_user and f.bee_action_id = a.id);
      v_state := '{}'::jsonb;
      v_food := null;
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
      v_food := null;
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
    if p_outcome->>'invalidate_pending' = 'true' or (v_food is not null and v_food <> 'null'::jsonb) then
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
    if v_kind = 'message' then
      insert into public.bee_messages(user_id,thread_id,role,text) values(p_user,p_thread,'user',v_turn.command->>'text');
    end if;
    if coalesce(length(v_text),0) > 0 then
      insert into public.bee_messages(user_id,thread_id,role,text,action_id,data)
        values(p_user,p_thread,'assistant',v_text,
          case when v_food is not null and v_food <> 'null'::jsonb then v_action.id else null end,
          case when v_food is not null and v_food <> 'null'::jsonb then jsonb_build_object('kind','food_review') else '{}'::jsonb end);
    end if;
    update public.bee_threads set state=v_state,version=version+1,updated_at=v_now
      where user_id=p_user and id=p_thread;
    v_result := jsonb_build_object('ok',true,'snapshot',public.bee_snapshot(p_user,p_thread) ||
      case when v_log_id is null then '{}'::jsonb else jsonb_build_object('saved_log_id',v_log_id,'summary_warning',v_warning) end);
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

create function public.reserve_ai_lookup(p_user uuid,p_request uuid,p_fingerprint text,p_token uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_now timestamptz := clock_timestamp();
  v_month text := to_char(v_now at time zone 'UTC','YYYY-MM');
  v_day text := to_char(v_now at time zone 'UTC','YYYY-MM-DD');
  v_minute text := to_char(v_now at time zone 'UTC','YYYY-MM-DD"T"HH24:MI');
  v_row public.ai_lookup_reservations%rowtype;
  v_expired public.ai_lookup_reservations%rowtype;
  v_pro boolean;
  v_count integer;
begin
  if p_user is null or p_request is null or p_token is null or p_fingerprint is null
    or length(p_fingerprint) not between 1 and 256 then
    return jsonb_build_object('ok',false,'error','bad_request');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('ai:' || p_user::text,0));
  select * into v_row from public.ai_lookup_reservations where user_id=p_user and request_id=p_request for update;
  if found then
    if v_row.fingerprint <> p_fingerprint then return jsonb_build_object('ok',false,'error','conflict'); end if;
    if v_row.status = 'completed' then
      if v_row.result is null then return jsonb_build_object('ok',false,'error','conflict'); end if;
      return jsonb_build_object('ok',true,'replay',true,'result',v_row.result);
    end if;
    if v_row.status = 'reserved' then
      if v_row.lease_token <> p_token and v_row.expires_at > v_now then
        return jsonb_build_object('ok',false,'error','busy');
      end if;
      if v_row.expires_at <= v_now then
        -- Recovery may relaunch a provider. It keeps the original daily and
        -- monthly credit, but must consume a fresh minute attempt so abandoned
        -- request IDs cannot bypass the shared rate limit.
        select count into v_count from public.ai_usage where user_id = p_user and period = v_minute;
        if coalesce(v_count,0) >= 15 then return jsonb_build_object('ok',false,'error','rate_limited'); end if;
        insert into public.ai_usage(user_id,period,count) values(p_user,v_minute,1)
          on conflict(user_id,period) do update set count=public.ai_usage.count+1;
      end if;
      update public.ai_lookup_reservations set lease_token=p_token,expires_at=v_now + interval '90 seconds'
        where user_id=p_user and request_id=p_request;
      return jsonb_build_object('ok',true,'replay',false,'token',p_token);
    end if;
  end if;
  -- Reclaim abandoned lookups. A late provider worker cannot finish after its
  -- token has been released or replaced. Attempts stay in the minute bucket.
  for v_expired in select * from public.ai_lookup_reservations
    where user_id=p_user and status='reserved' and expires_at<=v_now and request_id<>p_request for update loop
    update public.ai_usage set count=greatest(0,count-1)
      where user_id=p_user and period in (v_expired.month_period,v_expired.day_period);
    update public.ai_lookup_reservations set status='released',result=jsonb_build_object('error','provider_unavailable')
      where user_id=p_user and request_id=v_expired.request_id;
  end loop;
  select count into v_count from public.ai_usage where user_id=p_user and period=v_minute;
  if coalesce(v_count,0)>=15 then return jsonb_build_object('ok',false,'error','rate_limited'); end if;
  insert into public.ai_usage(user_id,period,count) values(p_user,v_minute,1)
    on conflict(user_id,period) do update set count=public.ai_usage.count+1;
  select coalesce(pro_until>v_now,false) into v_pro from public.entitlements where user_id=p_user;
  select count into v_count from public.ai_usage where user_id=p_user and period=case when coalesce(v_pro,false) then v_day else v_month end;
  if coalesce(v_count,0) >= (case when coalesce(v_pro,false) then 100 else 7 end) then
    return jsonb_build_object('ok',false,'error',case when coalesce(v_pro,false) then 'over_pro_cap' else 'over_free_quota' end);
  end if;
  insert into public.ai_usage(user_id,period,count) values(p_user,v_month,1),(p_user,v_day,1)
    on conflict(user_id,period) do update set count=public.ai_usage.count+1;
  insert into public.ai_lookup_reservations(user_id,request_id,fingerprint,status,lease_token,expires_at,month_period,day_period)
    values(p_user,p_request,p_fingerprint,'reserved',p_token,v_now+interval '90 seconds',v_month,v_day)
    on conflict(user_id,request_id) do update set status='reserved',lease_token=p_token,expires_at=excluded.expires_at,
      month_period=v_month,day_period=v_day,result=null;
  return jsonb_build_object('ok',true,'replay',false,'token',p_token);
end $$;

create function public.release_ai_lookup(p_user uuid,p_request uuid,p_token uuid,p_success boolean,p_result jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_row public.ai_lookup_reservations%rowtype;
begin
  if p_token is null or p_success is null or (p_success and p_result is null) or length(p_result::text)>60000
    or public.bee_contains_grounding(p_result)
    or p_result#>>'{draft,source}' = 'google_grounded' or p_result#>>'{draft,evidence,record}' = 'google_grounded' then
    return jsonb_build_object('ok',false,'error','bad_request');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('ai:' || p_user::text,0));
  select * into v_row from public.ai_lookup_reservations where user_id=p_user and request_id=p_request for update;
  if not found or v_row.lease_token is distinct from p_token then return jsonb_build_object('ok',false,'error','conflict'); end if;
  if v_row.status = 'released' and p_success then return jsonb_build_object('ok',false,'error','conflict'); end if;
  if v_row.status <> 'reserved' then return jsonb_build_object('ok',true,'replay',true); end if;
  if v_row.expires_at <= clock_timestamp() then return jsonb_build_object('ok',false,'error','conflict'); end if;
  if not p_success then
    update public.ai_usage set count=greatest(0,count-1) where user_id=p_user and period in (v_row.month_period,v_row.day_period);
  end if;
  update public.ai_lookup_reservations set status=case when p_success then 'completed' else 'released' end,result=p_result
    where user_id=p_user and request_id=p_request;
  return jsonb_build_object('ok',true,'replay',false);
end $$;

create function public.reserve_ai_search(p_user uuid,p_request uuid,p_token uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_now timestamptz := clock_timestamp();
  v_day text := to_char(v_now at time zone 'UTC','YYYY-MM-DD');
  v_lookup public.ai_lookup_reservations%rowtype;
  v_pro boolean;
  v_limit integer;
  v_count integer;
begin
  if p_user is null or p_request is null or p_token is null then
    return jsonb_build_object('ok',false,'error','bad_request');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('ai:' || p_user::text,0));
  select * into v_lookup from public.ai_lookup_reservations
    where user_id = p_user and request_id = p_request for update;
  if not found or v_lookup.lease_token is distinct from p_token or v_lookup.status <> 'reserved' or v_lookup.expires_at <= v_now then
    return jsonb_build_object('ok',false,'error','conflict');
  end if;
  select coalesce(pro_until > v_now,false) into v_pro from public.entitlements where user_id = p_user;
  v_limit := case when coalesce(v_pro,false) then 20 else 3 end;
  select count(*) into v_count from public.ai_search_reservations where user_id = p_user and day_period = v_day;
  if exists(select 1 from public.ai_search_reservations where user_id = p_user and request_id = p_request) then
    return jsonb_build_object('ok',true,'replay',true,'search_remaining',greatest(0,v_limit-v_count));
  end if;
  if v_count >= v_limit then return jsonb_build_object('ok',false,'error','rate_limited'); end if;
  insert into public.ai_search_reservations(user_id,request_id,lease_token,day_period)
    values(p_user,p_request,p_token,v_day);
  return jsonb_build_object('ok',true,'replay',false,'search_remaining',v_limit-v_count-1);
end $$;

create function public.measure_ai_search(p_user uuid,p_request uuid,p_token uuid,p_count integer)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_search public.ai_search_reservations%rowtype;
begin
  if p_user is null or p_request is null or p_token is null or p_count is null or p_count not between 0 and 100 then
    return jsonb_build_object('ok',false,'error','bad_request');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('ai:' || p_user::text,0));
  select * into v_search from public.ai_search_reservations where user_id = p_user and request_id = p_request for update;
  if not found or v_search.lease_token is distinct from p_token then return jsonb_build_object('ok',false,'error','conflict'); end if;
  if v_search.query_count is not null then
    if v_search.query_count <> p_count then return jsonb_build_object('ok',false,'error','conflict'); end if;
    return jsonb_build_object('ok',true,'replay',true);
  end if;
  update public.ai_search_reservations set query_count = p_count where user_id = p_user and request_id = p_request;
  return jsonb_build_object('ok',true,'replay',false);
end $$;

-- The only client-callable mutation added here recomputes derived data for
-- auth.uid(). It cannot accept an owner, reviewed draft, or food-log payload.
create function public.refresh_daily_summary(p_day date,p_timezone text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then return jsonb_build_object('ok',false,'error','unauthorized'); end if;
  if p_day is null or p_timezone is null or not exists(select 1 from pg_timezone_names where name=p_timezone) then
    return jsonb_build_object('ok',false,'error','bad_request');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('bee:' || v_user::text,0));
  begin
    insert into public.daily_summaries(user_id,date,calories,protein,carbs,fat,meal_count)
      select v_user,p_day,round(coalesce(sum(calories),0)),round(coalesce(sum(protein),0)),
        round(coalesce(sum(carbs),0)),round(coalesce(sum(fat),0)),count(*)
      from public.food_logs where user_id=v_user
        and created_at >= (p_day::timestamp at time zone p_timezone)
        and created_at < ((p_day+1)::timestamp at time zone p_timezone)
      on conflict(user_id,date) do update set calories=excluded.calories,protein=excluded.protein,
        carbs=excluded.carbs,fat=excluded.fat,meal_count=excluded.meal_count;
  exception when others then return jsonb_build_object('ok',false,'error','save_failed');
  end;
  return jsonb_build_object('ok',true);
end $$;

revoke all on function public.bee_snapshot(uuid,uuid) from public,anon,authenticated;
revoke all on function public.bee_prune_history(uuid) from public,anon,authenticated;
revoke all on function public.bee_prune_all_history() from public,anon,authenticated;
revoke all on function public.bee_contains_grounding(jsonb) from public,anon,authenticated;
revoke all on function public.bee_begin_turn(uuid,uuid,uuid,text,integer,text,jsonb) from public,anon,authenticated;
revoke all on function public.bee_finish_turn(uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.reserve_ai_lookup(uuid,uuid,text,uuid) from public,anon,authenticated;
revoke all on function public.release_ai_lookup(uuid,uuid,uuid,boolean,jsonb) from public,anon,authenticated;
revoke all on function public.reserve_ai_search(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.measure_ai_search(uuid,uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.bee_snapshot(uuid,uuid) to service_role;
grant execute on function public.bee_prune_history(uuid) to service_role;
grant execute on function public.bee_prune_all_history() to service_role;
grant execute on function public.bee_begin_turn(uuid,uuid,uuid,text,integer,text,jsonb) to service_role;
grant execute on function public.bee_finish_turn(uuid,uuid,uuid,uuid,jsonb) to service_role;
grant execute on function public.reserve_ai_lookup(uuid,uuid,text,uuid) to service_role;
grant execute on function public.release_ai_lookup(uuid,uuid,uuid,boolean,jsonb) to service_role;
grant execute on function public.reserve_ai_search(uuid,uuid,uuid) to service_role;
grant execute on function public.measure_ai_search(uuid,uuid,uuid,integer) to service_role;
revoke all on function public.refresh_daily_summary(date,text) from public,anon,authenticated;
grant execute on function public.refresh_daily_summary(date,text) to authenticated;

-- Supabase provides pg_cron. Plain PostgreSQL test installations may not; the
-- same maintenance function is still callable by a service scheduler there.
-- https://supabase.com/docs/guides/cron/install
-- https://supabase.com/docs/guides/cron/quickstart
do $$
begin
  if exists(select 1 from pg_available_extensions where name = 'pg_cron') then
    execute 'create extension if not exists pg_cron with schema pg_catalog';
    perform cron.schedule('trackbing-bee-history-retention','0 * * * *','select public.bee_prune_all_history()');
  else
    raise notice 'pg_cron unavailable: schedule bee_prune_all_history() hourly using a service-only scheduler';
  end if;
end $$;

notify pgrst, 'reload schema';
