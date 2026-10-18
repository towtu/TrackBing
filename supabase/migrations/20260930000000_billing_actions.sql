-- All provider requests are authenticated, serialized per account, and recoverable for 24h.
create table public.billing_provider_bindings(provider text not null check(provider in ('apple','google')),account_token text not null,user_id uuid not null references auth.users(id) on delete cascade,primary key(provider,account_token),unique(provider,user_id));
create table public.billing_purchase_credentials(provider text not null check(provider in ('google')),external_id text not null,user_id uuid not null references auth.users(id) on delete cascade,purchase_token text not null check(length(purchase_token) between 1 and 2048),primary key(provider,external_id));
create table public.billing_attempts(user_id uuid not null references auth.users(id) on delete cascade,created_at timestamptz not null default now());
create index billing_attempts_owner_time on public.billing_attempts(user_id,created_at);
alter table public.billing_provider_bindings enable row level security;
alter table public.billing_purchase_credentials enable row level security;
alter table public.billing_attempts enable row level security;
revoke all on public.billing_provider_bindings,public.billing_purchase_credentials,public.billing_attempts from public,anon,authenticated;
grant all on public.billing_provider_bindings,public.billing_purchase_credentials,public.billing_attempts to service_role;
-- Private verified payment mapping: refunds are joined to their actual invoice, never to a body-supplied user.
create table public.billing_web_payment_links(payment_id text primary key,user_id uuid not null references auth.users(id) on delete cascade,external_id text not null,invoice_id text not null,payment_intent_id text not null,created_at timestamptz not null default now());
create index billing_web_payment_links_owner on public.billing_web_payment_links(user_id,external_id);
alter table public.billing_web_payment_links enable row level security;
revoke all on public.billing_web_payment_links from public,anon,authenticated;
grant all on public.billing_web_payment_links to service_role;
create function public.begin_billing_request(p_user uuid,p_request uuid,p_fingerprint text,p_token uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.billing_requests%rowtype; begin
 if p_user is null or p_request is null or p_token is null or p_fingerprint is null or length(p_fingerprint) not between 1 and 256 then return jsonb_build_object('ok',false,'error','bad_request'); end if;
 perform pg_advisory_xact_lock(hashtextextended('billing:'||p_user::text,0));
 select * into r from public.billing_requests where user_id=p_user and request_id=p_request for update;
 if found then
  if r.fingerprint<>p_fingerprint then return jsonb_build_object('ok',false,'error','conflict'); end if;
  if r.result is not null then return jsonb_build_object('ok',true,'replay',true,'result',r.result); end if;
  if r.lease_until>clock_timestamp() then return jsonb_build_object('ok',false,'error','busy'); end if;
  if r.created_at<clock_timestamp()-interval '23 hours' then return jsonb_build_object('ok',false,'error','reconciliation_required'); end if;
 end if;
 if exists(select 1 from public.billing_requests where user_id=p_user and lease_until>clock_timestamp() and result is null) then return jsonb_build_object('ok',false,'error','busy'); end if;
 if (select count(*) from public.billing_attempts where user_id=p_user and created_at>clock_timestamp()-interval '1 minute')>=15 then return jsonb_build_object('ok',false,'error','rate_limited'); end if;
 insert into public.billing_attempts(user_id) values(p_user);
 insert into public.billing_requests values(p_user,p_request,p_fingerprint,p_token,clock_timestamp()+interval '90 seconds',null,now()) on conflict(user_id,request_id) do update set lease_token=excluded.lease_token,lease_until=excluded.lease_until;
 return jsonb_build_object('ok',true,'replay',false);
end $$;
create function public.finish_billing_request(p_user uuid,p_request uuid,p_token uuid,p_result jsonb) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$ begin
 update public.billing_requests set result=p_result,lease_until=now() where user_id=p_user and request_id=p_request and lease_token=p_token and lease_until>clock_timestamp();return found;
end $$;
revoke all on function public.begin_billing_request(uuid,uuid,text,uuid),public.finish_billing_request(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.begin_billing_request(uuid,uuid,text,uuid),public.finish_billing_request(uuid,uuid,uuid,jsonb) to service_role;
-- Older function binaries fail closed after switching business policy; never keep a second quota.
create or replace function public.reserve_ai_lookup(p_user uuid,p_request uuid,p_fingerprint text,p_token uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$ begin return jsonb_build_object('ok',false,'error','upgrade_required'); end $$;

-- Record the capability at creation as well as rechecking it at confirmation.
alter table public.bee_pending_actions add column origin_tier text check(origin_tier in ('plus','pro'));
update public.bee_pending_actions set status='expired' where status='pending'; -- Old free-policy proposals require a new paid review.
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
  v_origin text;
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
  perform pg_advisory_xact_lock(hashtextextended('billing:'||p_user::text,0));
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
    elsif coalesce(v_confirm,false) and (v_action.origin_tier is null or (v_action.action_kind<>'food' and v_action.origin_tier<>'pro')) then
      v_error:='stale_action';
    elsif coalesce(v_confirm,false) and ((public.resolve_entitlement(p_user)->>'tier')='basic' or (v_action.action_kind<>'food' and (public.resolve_entitlement(p_user)->>'tier')<>'pro')) then
      v_error:=case when v_action.action_kind='food' then 'upgrade_required' else 'pro_required' end;
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
      update public.ai_budget_requests set result=null where user_id=p_user;
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
      update public.ai_budget_requests set result=null where user_id=p_user;
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
        delete from public.bee_turns where user_id=p_user and request_id<>p_request and status<>'running';
        update public.ai_budget_requests set result=null where user_id=p_user;
        update public.bee_threads set state=state-'memory'-'memories',version=version+1,lease_request=null,lease_token=null,lease_expires_at=null where user_id=p_user and id<>p_thread;
      else
        insert into public.bee_memories(user_id,key,value) values(p_user,v_memory->>'key',v_memory->>'value')
          on conflict(user_id,key) do update set value=excluded.value,updated_at=v_now;
      end if;
    end if;
    if p_outcome->>'invalidate_pending' = 'true' or (v_food is not null and v_food <> 'null'::jsonb) or (v_weight is not null and v_weight<>'null'::jsonb) or (v_goal is not null and v_goal<>'null'::jsonb) then
      update public.bee_pending_actions set status = 'superseded'
        where user_id = p_user and thread_id = p_thread and status = 'pending';
    end if;
    if v_food is not null and v_food <> 'null'::jsonb or v_weight is not null and v_weight<>'null'::jsonb or v_goal is not null and v_goal<>'null'::jsonb then
      v_origin:=public.resolve_entitlement(p_user)->>'tier';
      if v_origin='basic' or (v_origin<>'pro' and ((v_weight is not null and v_weight<>'null'::jsonb) or (v_goal is not null and v_goal<>'null'::jsonb))) then raise exception 'Tier no longer permits this proposal'; end if;
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
      insert into public.bee_pending_actions(user_id,thread_id,review_version,food,local_date,time_zone,origin_tier,expires_at)
        values(p_user,p_thread,v_thread.version+1,v_food,(v_now at time zone v_turn.time_zone)::date,v_turn.time_zone,v_origin,
          least(v_now + interval '30 minutes',(((v_now at time zone v_turn.time_zone)::date + 1)::timestamp at time zone v_turn.time_zone)))
        returning * into v_action;
      v_state := jsonb_set(v_state,'{awaiting}','"review"');
    end if;
    if v_weight is not null and v_weight<>'null'::jsonb or v_goal is not null and v_goal<>'null'::jsonb then
      if v_food is not null and v_food<>'null'::jsonb or (v_weight is not null and v_weight<>'null'::jsonb and v_goal is not null and v_goal<>'null'::jsonb) then raise exception 'Ambiguous action'; end if;
      v_action_kind:=case when v_weight is not null and v_weight<>'null'::jsonb then 'weight' else 'goal' end;
      if (v_action_kind='weight' and not public.adaptive_validate_weight(p_user,v_weight,v_turn.time_zone)) or
        (v_action_kind='goal' and not public.adaptive_validate_goal(p_user,v_goal)) then raise exception 'Invalid reviewed action' using errcode='22023'; end if;
      insert into public.bee_pending_actions(user_id,thread_id,review_version,food,action_kind,weight,goal,local_date,time_zone,origin_tier,expires_at)
        values(p_user,p_thread,v_thread.version+1,'{}'::jsonb,v_action_kind,v_weight,v_goal,
          case when v_action_kind='weight' then (v_weight->>'localDate')::date else (v_now at time zone v_turn.time_zone)::date end,
          v_turn.time_zone,v_origin,least(v_now+interval '30 minutes',(((v_now at time zone v_turn.time_zone)::date+1)::timestamp at time zone v_turn.time_zone))) returning * into v_action;
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


create or replace function public.bee_prune_history(p_user uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_threads uuid[];
  v_removed_requests uuid[];
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
    delete from public.bee_turns where user_id=p_user and (created_at<v_now-interval '30 days' or thread_id=any(v_threads)) and (status<>'running' or lease_expires_at<=v_now) returning request_id
  ) select array_agg(request_id) into v_removed_requests from removed;
  update public.ai_lookup_reservations set result=null where user_id=p_user and request_id=any(v_removed_requests);
  update public.ai_budget_requests set result=null where user_id=p_user and request_id=any(v_removed_requests);
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
  update public.ai_budget_requests set result=null where user_id=p_user and created_at<v_now-interval '30 days';
  update public.billing_requests set result=null where user_id=p_user and created_at<v_now-interval '30 days';
  delete from public.billing_attempts where user_id=p_user and created_at<v_now-interval '1 day';
  update public.bee_insights set text=null,pose=null,expires_at=null where user_id=p_user and expires_at<=v_now;
end $$;

-- Manual diary writes stay free, but a client cannot impersonate an approved Bee write.
-- Invoker context distinguishes PostgREST client roles from service/private RPC execution.
create function public.protect_bee_food_provenance() returns trigger language plpgsql set search_path=public,pg_temp as $$ begin
 if current_user in ('authenticated','anon') then
  if tg_op='INSERT' and (new.bee_action_id is not null or new.bee_provenance is not null) then raise exception 'Bee provenance is server-owned' using errcode='42501'; end if;
  if tg_op='UPDATE' then
   if new.bee_action_id is distinct from old.bee_action_id or new.bee_provenance is distinct from old.bee_provenance then raise exception 'Bee provenance is server-owned' using errcode='42501'; end if;
   if old.bee_action_id is not null and row(new.name,new.calories,new.protein,new.carbs,new.fat,new.serving_size,new.serving_unit,new.created_at) is distinct from row(old.name,old.calories,old.protein,old.carbs,old.fat,old.serving_size,old.serving_unit,old.created_at) then
    new.bee_provenance:=coalesce(old.bee_provenance,'{}'::jsonb)||jsonb_build_object('user_edited',true);
   end if;
  end if;
 end if; return new;
end $$;
revoke all on function public.protect_bee_food_provenance() from public,anon,authenticated;
create trigger protect_bee_food_provenance before insert or update on public.food_logs for each row execute function public.protect_bee_food_provenance();

-- New clients provide both local-midnight boundaries (a DST day is not always 24h).
-- Keep the original one-argument API for old clients; this overload is read-only.
create function public.get_weekly_stats(p_today_start timestamptz,p_today_end timestamptz)
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
begin
  if auth.uid() is null or p_today_start is null or p_today_end is null or
    not isfinite(p_today_start) or not isfinite(p_today_end) or
    p_today_end <= p_today_start or p_today_end-p_today_start > interval '27 hours' then
    raise exception 'Invalid diary day';
  end if;
  return jsonb_build_object(
    'calorie_target',(select calorie_target from public.user_goals where user_id=auth.uid() limit 1),
    'summaries',coalesce((select jsonb_agg(jsonb_build_object('date',date,'calories',calories,'protein',protein,'carbs',carbs,'fat',fat,'meal_count',meal_count) order by date desc) from public.daily_summaries where user_id=auth.uid()),'[]'::jsonb),
    'today',(select jsonb_build_object('calories',coalesce(sum(calories),0),'protein',coalesce(sum(protein),0),'carbs',coalesce(sum(carbs),0),'fat',coalesce(sum(fat),0),'count',count(*)) from public.food_logs where user_id=auth.uid() and created_at>=p_today_start and created_at<p_today_end)
  );
end; $$;
revoke all on function public.get_weekly_stats(timestamptz,timestamptz) from public,anon;
grant execute on function public.get_weekly_stats(timestamptz,timestamptz) to authenticated;
