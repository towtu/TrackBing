-- Verified paid access; no client tier or old pro_until can grant privileges.
create table public.subscriptions (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 provider text not null check(provider in ('web','apple','google','legacy')), external_id text not null check(length(external_id) between 1 and 2048),
 product_id text not null check(length(product_id) between 1 and 200), tier text not null check(tier in ('plus','pro')),
 status text not null check(status in ('active','cancelled','grace','expired','revoked')),
 current_period_start timestamptz not null, current_period_end timestamptz not null, paid_through timestamptz not null,
 auto_renew boolean not null, billing_interval text not null check(billing_interval in ('monthly','annual')),
 transaction_id text, event_at timestamptz not null, updated_at timestamptz not null default now(),
 check(isfinite(current_period_start) and isfinite(current_period_end) and isfinite(paid_through) and current_period_end>current_period_start),
 unique(provider,external_id)
);
create index subscriptions_owner_active on public.subscriptions(user_id,paid_through);
create table public.subscription_events(provider text not null,event_id text not null,event_at timestamptz not null,user_id uuid not null references auth.users(id) on delete cascade,created_at timestamptz not null default now(),primary key(provider,event_id));
create table public.verified_legacy_subscriptions(user_id uuid primary key references auth.users(id) on delete cascade,external_id text unique not null,paid_through timestamptz not null,evidence_reference text not null check(length(evidence_reference) between 1 and 500));
create table public.billing_accounts(user_id uuid primary key references auth.users(id) on delete cascade,anchor timestamptz not null);
create table public.billing_requests(user_id uuid not null references auth.users(id) on delete cascade,request_id uuid not null,fingerprint text not null,lease_token uuid not null,lease_until timestamptz not null,result jsonb,created_at timestamptz not null default now(),primary key(user_id,request_id));
create table public.billing_web_customers(user_id uuid primary key references auth.users(id) on delete cascade,customer_id text unique not null);
create table public.billing_web_checkouts(user_id uuid not null references auth.users(id) on delete cascade,request_id uuid not null,external_id text unique not null,customer_id text not null,product_id text not null,created_at timestamptz not null default now(),primary key(user_id,request_id));
create table public.ai_monthly_usage(user_id uuid not null references auth.users(id) on delete cascade,period timestamptz not null,requests integer not null default 0,insights integer not null default 0,input_tokens bigint not null default 0,output_tokens bigint not null default 0,search_queries integer not null default 0,reserved_input bigint not null default 0,reserved_output bigint not null default 0,check(least(requests,insights,input_tokens,output_tokens,search_queries,reserved_input,reserved_output)>=0),primary key(user_id,period));
create table public.ai_budget_requests(user_id uuid not null references auth.users(id) on delete cascade,request_id uuid not null,fingerprint text not null,token uuid not null,feature text not null check(feature in ('ai_food_assist','bee_chat','bee_dashboard_insight')),period timestamptz not null,reserved_input integer not null,reserved_output integer not null,status text not null check(status in ('running','completed','failed')),lease_until timestamptz not null,result jsonb,created_at timestamptz not null default now(),primary key(user_id,request_id));
create table public.ai_call_usage(user_id uuid not null,request_id uuid not null,call_id uuid not null,input_tokens integer not null check(input_tokens>=0),output_tokens integer not null check(output_tokens>=0),primary key(user_id,request_id,call_id),foreign key(user_id,request_id) references public.ai_budget_requests(user_id,request_id) on delete cascade);
create table public.ai_search_calls(user_id uuid not null,request_id uuid not null,call_id uuid not null,queries integer not null check(queries between 0 and 32),measured boolean not null default false,primary key(user_id,request_id,call_id),foreign key(user_id,request_id) references public.ai_budget_requests(user_id,request_id) on delete cascade);
do $$ declare t text; begin foreach t in array array['subscriptions','subscription_events','verified_legacy_subscriptions','billing_accounts','billing_requests','billing_web_customers','billing_web_checkouts','ai_monthly_usage','ai_budget_requests','ai_call_usage','ai_search_calls'] loop
 execute format('alter table public.%I enable row level security',t); execute format('revoke all on public.%I from public,anon,authenticated',t); execute format('grant all on public.%I to service_role',t);
 end loop; end $$;
grant select on public.subscriptions,public.ai_monthly_usage to authenticated;
create policy subscription_owner on public.subscriptions for select to authenticated using(auth.uid()=user_id);
create policy monthly_usage_owner on public.ai_monthly_usage for select to authenticated using(auth.uid()=user_id);

create function public.billing_period(p_anchor timestamptz,p_at timestamptz) returns timestamptz language plpgsql immutable set search_path=public,pg_temp as $$
declare n integer; v timestamptz; begin
 n:=(extract(year from p_at at time zone 'UTC')-extract(year from p_anchor at time zone 'UTC'))::integer*12+(extract(month from p_at at time zone 'UTC')-extract(month from p_anchor at time zone 'UTC'))::integer;
 v:=(p_anchor at time zone 'UTC'+make_interval(months=>n)) at time zone 'UTC';
 if v>p_at then v:=(p_anchor at time zone 'UTC'+make_interval(months=>n-1)) at time zone 'UTC'; end if; return v;
end $$;
create function public.resolve_entitlement(p_user uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.subscriptions%rowtype; a timestamptz; p timestamptz; r timestamptz; u public.ai_monthly_usage%rowtype; t text:='basic'; l jsonb; begin
 select * into s from public.subscriptions where user_id=p_user and status in ('active','cancelled','grace') and paid_through>clock_timestamp() order by case tier when 'pro' then 2 else 1 end desc,paid_through desc limit 1;
 if found then t:=s.tier; end if;
 select anchor into a from public.billing_accounts where user_id=p_user;
 if a is not null then p:=public.billing_period(a,clock_timestamp()); r:=(a at time zone 'UTC'+make_interval(months=>((extract(year from p at time zone 'UTC')-extract(year from a at time zone 'UTC'))::integer*12+(extract(month from p at time zone 'UTC')-extract(month from a at time zone 'UTC'))::integer)+1)) at time zone 'UTC'; end if;
 select * into u from public.ai_monthly_usage where user_id=p_user and period=p;
 l:=case t when 'pro' then '{"requests":250,"search":50,"insights":30,"input_tokens":800000,"output_tokens":200000}'::jsonb when 'plus' then '{"requests":60,"search":10,"insights":0,"input_tokens":160000,"output_tokens":50000}'::jsonb else '{"requests":0,"search":0,"insights":0,"input_tokens":0,"output_tokens":0}'::jsonb end;
 return jsonb_build_object('tier',t,'capabilities',jsonb_build_object('manual_tracking',true,'ai_food_assist',t<>'basic','google_food_search',t<>'basic','bee_chat',t='pro','bee_weight_actions',t='pro','bee_goal_proposal',t='pro','bee_memory_write',t='pro','bee_dashboard_insight',t='pro'),'period',p,'reset_at',r,'limits',l,
 'used',jsonb_build_object('requests',coalesce(u.requests,0),'search',coalesce(u.search_queries,0),'insights',coalesce(u.insights,0),'input_tokens',coalesce(u.input_tokens,0),'output_tokens',coalesce(u.output_tokens,0)),
 'remaining',jsonb_build_object('requests',greatest(0,(l->>'requests')::int-coalesce(u.requests,0)),'search',greatest(0,(l->>'search')::int-coalesce(u.search_queries,0)),'insights',greatest(0,(l->>'insights')::int-coalesce(u.insights,0)),'input_tokens',greatest(0,(l->>'input_tokens')::bigint-coalesce(u.input_tokens,0)-coalesce(u.reserved_input,0)),'output_tokens',greatest(0,(l->>'output_tokens')::bigint-coalesce(u.output_tokens,0)-coalesce(u.reserved_output,0))),
 'duplicate_subscriptions',(select count(*)>1 from public.subscriptions where user_id=p_user and status in ('active','cancelled','grace') and paid_through>clock_timestamp()));
end $$;
create function public.account_entitlement() returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$ begin if auth.uid() is null then raise exception 'Authentication required'; end if; return public.resolve_entitlement(auth.uid()); end $$;

create function public.reconcile_subscription(p_provider text,p_event_id text,p_event_at timestamptz,p_user uuid,p_subscription jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.subscriptions%rowtype; v public.subscriptions%rowtype; begin
 if p_provider is null or p_event_id is null or p_provider not in ('web','apple','google','legacy') or p_user is null or p_event_at is null or not isfinite(p_event_at) or p_event_at>clock_timestamp()+interval '5 minutes' or length(p_event_id) not between 1 and 300 or jsonb_typeof(p_subscription) is distinct from 'object' then return jsonb_build_object('ok',false,'error','bad_request'); end if;
 perform pg_advisory_xact_lock(hashtextextended('billing:'||p_user::text,0));
 if exists(select 1 from public.subscription_events where provider=p_provider and event_id=p_event_id) then return jsonb_build_object('ok',true,'duplicate',true,'entitlement',public.resolve_entitlement(p_user)); end if;
 v:=jsonb_populate_record(null::public.subscriptions,p_subscription);
 if v.external_id is null or v.tier not in ('plus','pro') or v.status not in ('active','cancelled','grace','expired','revoked') or v.product_id is null or v.current_period_start is null or v.current_period_end is null or v.paid_through is null or v.auto_renew is null or v.billing_interval is null then return jsonb_build_object('ok',false,'error','bad_request'); end if;
 if p_provider='legacy' and not exists(select 1 from public.verified_legacy_subscriptions where user_id=p_user and external_id=v.external_id and paid_through=v.paid_through) then return jsonb_build_object('ok',false,'error','unverified_legacy'); end if;
 select * into s from public.subscriptions where provider=p_provider and external_id=v.external_id for update;
 if found and s.user_id<>p_user then return jsonb_build_object('ok',false,'error','ownership_conflict'); end if;
 insert into public.subscription_events values(p_provider,p_event_id,p_event_at,p_user,now());
 if s.id is not null and (s.event_at>p_event_at or (s.event_at=p_event_at and s.status='revoked')) then return jsonb_build_object('ok',true,'ignored',true,'entitlement',public.resolve_entitlement(p_user)); end if;
 insert into public.subscriptions(user_id,provider,external_id,product_id,tier,status,current_period_start,current_period_end,paid_through,auto_renew,billing_interval,transaction_id,event_at)
 values(p_user,p_provider,v.external_id,v.product_id,v.tier,v.status,v.current_period_start,v.current_period_end,v.paid_through,v.auto_renew,v.billing_interval,v.transaction_id,p_event_at)
 on conflict(provider,external_id) do update set product_id=excluded.product_id,tier=excluded.tier,status=excluded.status,current_period_start=excluded.current_period_start,current_period_end=excluded.current_period_end,paid_through=excluded.paid_through,auto_renew=excluded.auto_renew,billing_interval=excluded.billing_interval,transaction_id=excluded.transaction_id,event_at=excluded.event_at,updated_at=now();
 if v.status in ('active','cancelled','grace') and v.paid_through>clock_timestamp() then insert into public.billing_accounts values(p_user,v.current_period_start) on conflict do nothing; end if;
 return jsonb_build_object('ok',true,'entitlement',public.resolve_entitlement(p_user));
end $$;

create function public.reserve_ai_budget(p_user uuid,p_request uuid,p_fingerprint text,p_token uuid,p_feature text,p_input_budget integer,p_output_budget integer) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare e jsonb; b public.ai_budget_requests%rowtype; old public.ai_budget_requests%rowtype; p timestamptz; begin
 if p_user is null or p_request is null or p_token is null or p_fingerprint is null or p_feature is null or p_input_budget is null or p_output_budget is null or length(p_fingerprint) not between 1 and 256 or p_feature not in ('ai_food_assist','bee_chat','bee_dashboard_insight') or p_input_budget not between 1 and 30000 or p_output_budget not between 1 and 16000 then return jsonb_build_object('ok',false,'error','bad_request'); end if;
 perform pg_advisory_xact_lock(hashtextextended('billing:'||p_user::text,0));
 e:=public.resolve_entitlement(p_user);
 if e->>'tier'='basic' then return jsonb_build_object('ok',false,'error','upgrade_required'); end if;
 if p_feature<>'ai_food_assist' and e->>'tier'<>'pro' then return jsonb_build_object('ok',false,'error','pro_required'); end if;
 select * into b from public.ai_budget_requests where user_id=p_user and request_id=p_request for update;
 if found then
  if b.fingerprint<>p_fingerprint or b.feature<>p_feature then return jsonb_build_object('ok',false,'error','conflict'); end if;
  if b.status='completed' then return jsonb_build_object('ok',true,'replay',true,'result',b.result); end if;
  if b.status='running' and b.lease_until>clock_timestamp() then return jsonb_build_object('ok',false,'error','busy'); end if;
  -- A consumed provider attempt cannot be launched again with the same request.
  if exists(select 1 from public.ai_call_usage where user_id=p_user and request_id=p_request) then return jsonb_build_object('ok',false,'error','provider_unavailable'); end if;
 end if;
 for old in select * from public.ai_budget_requests where user_id=p_user and status='running' and lease_until<=clock_timestamp() for update loop
  update public.ai_monthly_usage set reserved_input=greatest(0,reserved_input-old.reserved_input),reserved_output=greatest(0,reserved_output-old.reserved_output),requests=requests-case when old.feature<>'bee_dashboard_insight' and not exists(select 1 from public.ai_call_usage where user_id=p_user and request_id=old.request_id) then 1 else 0 end,insights=insights-case when old.feature='bee_dashboard_insight' and not exists(select 1 from public.ai_call_usage where user_id=p_user and request_id=old.request_id) then 1 else 0 end where user_id=p_user and period=old.period;
  update public.ai_budget_requests set status='failed',reserved_input=0,reserved_output=0 where user_id=p_user and request_id=old.request_id;
 end loop;
 if (select count(*) from public.ai_budget_requests where user_id=p_user and created_at>clock_timestamp()-interval '1 minute')>=15 then return jsonb_build_object('ok',false,'error','rate_limited'); end if;
 if exists(select 1 from public.ai_budget_requests where user_id=p_user and status='running') then return jsonb_build_object('ok',false,'error','busy'); end if;
 e:=public.resolve_entitlement(p_user); p:=(e->>'period')::timestamptz;
 if (e#>>array['remaining',case when p_feature='bee_dashboard_insight' then 'insights' else 'requests' end])::int<1 then return jsonb_build_object('ok',false,'error',case when p_feature='bee_dashboard_insight' then 'monthly_insight_limit' else 'monthly_request_limit' end); end if;
 if (e#>>'{remaining,input_tokens}')::bigint<p_input_budget then return jsonb_build_object('ok',false,'error','monthly_input_limit'); end if;
 if (e#>>'{remaining,output_tokens}')::bigint<p_output_budget then return jsonb_build_object('ok',false,'error','monthly_output_limit'); end if;
 insert into public.ai_monthly_usage(user_id,period) values(p_user,p) on conflict do nothing;
 update public.ai_monthly_usage set requests=requests+case when p_feature='bee_dashboard_insight' then 0 else 1 end,insights=insights+case when p_feature='bee_dashboard_insight' then 1 else 0 end,reserved_input=reserved_input+p_input_budget,reserved_output=reserved_output+p_output_budget where user_id=p_user and period=p;
 insert into public.ai_budget_requests values(p_user,p_request,p_fingerprint,p_token,p_feature,p,p_input_budget,p_output_budget,'running',clock_timestamp()+interval '90 seconds',null,now()) on conflict(user_id,request_id) do update set token=p_token,period=p,reserved_input=p_input_budget,reserved_output=p_output_budget,status='running',lease_until=excluded.lease_until;
 return jsonb_build_object('ok',true,'replay',false);
end $$;
create function public.record_ai_call(p_user uuid,p_request uuid,p_token uuid,p_call uuid,p_input_tokens integer,p_output_tokens integer) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare b public.ai_budget_requests%rowtype; begin
 perform pg_advisory_xact_lock(hashtextextended('billing:'||p_user::text,0));
 select * into b from public.ai_budget_requests where user_id=p_user and request_id=p_request and token=p_token;
 if not found or p_input_tokens not between 0 and 2000000 or p_output_tokens not between 0 and 2000000 then return jsonb_build_object('ok',false,'error','bad_request'); end if;
 insert into public.ai_call_usage values(p_user,p_request,p_call,p_input_tokens,p_output_tokens) on conflict do nothing;
 if found then update public.ai_monthly_usage set input_tokens=input_tokens+p_input_tokens,output_tokens=output_tokens+p_output_tokens where user_id=p_user and period=b.period; end if;
 return jsonb_build_object('ok',true);
end $$;
create function public.finish_ai_budget(p_user uuid,p_request uuid,p_token uuid,p_success boolean,p_result jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare b public.ai_budget_requests%rowtype; begin
 if public.bee_contains_grounding(p_result) then return jsonb_build_object('ok',false,'error','bad_request'); end if;
 perform pg_advisory_xact_lock(hashtextextended('billing:'||p_user::text,0));
 select * into b from public.ai_budget_requests where user_id=p_user and request_id=p_request and token=p_token for update;
 if not found then return jsonb_build_object('ok',false,'error','conflict'); end if;
 if b.status<>'running' then return jsonb_build_object('ok',true); end if;
 update public.ai_monthly_usage set reserved_input=greatest(0,reserved_input-b.reserved_input),reserved_output=greatest(0,reserved_output-b.reserved_output),requests=requests-case when not p_success and b.feature<>'bee_dashboard_insight' and not exists(select 1 from public.ai_call_usage where user_id=p_user and request_id=p_request) then 1 else 0 end,insights=insights-case when not p_success and b.feature='bee_dashboard_insight' and not exists(select 1 from public.ai_call_usage where user_id=p_user and request_id=p_request) then 1 else 0 end where user_id=p_user and period=b.period;
 update public.ai_budget_requests set status=case when p_success then 'completed' else 'failed' end,result=p_result,reserved_input=0,reserved_output=0 where user_id=p_user and request_id=p_request;
 return jsonb_build_object('ok',true);
end $$;
create function public.reserve_ai_search_queries(p_user uuid,p_request uuid,p_token uuid,p_call uuid,p_queries integer) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare b public.ai_budget_requests%rowtype; e jsonb; begin
 perform pg_advisory_xact_lock(hashtextextended('billing:'||p_user::text,0)); e:=public.resolve_entitlement(p_user);
 select * into b from public.ai_budget_requests where user_id=p_user and request_id=p_request and token=p_token and status='running';
 if not found or p_queries not between 1 and 32 then return jsonb_build_object('ok',false,'error','bad_request'); end if;
 if exists(select 1 from public.ai_search_calls where user_id=p_user and request_id=p_request and call_id=p_call) then return jsonb_build_object('ok',false,'error','search_unavailable'); end if;
 if e->>'tier'='basic' or (e#>>'{remaining,search}')::int<p_queries then return jsonb_build_object('ok',false,'error','monthly_search_limit'); end if;
 insert into public.ai_search_calls values(p_user,p_request,p_call,p_queries,false); update public.ai_monthly_usage set search_queries=search_queries+p_queries where user_id=p_user and period=b.period; return jsonb_build_object('ok',true,'replay',false,'search_remaining',(e#>>'{remaining,search}')::int-p_queries);
end $$;
create function public.measure_ai_search_queries(p_user uuid,p_request uuid,p_token uuid,p_call uuid,p_actual integer) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare b public.ai_budget_requests%rowtype; s public.ai_search_calls%rowtype; begin
 perform pg_advisory_xact_lock(hashtextextended('billing:'||p_user::text,0)); select * into b from public.ai_budget_requests where user_id=p_user and request_id=p_request and token=p_token;
 if not found or p_actual not between 0 and 32 then return jsonb_build_object('ok',false,'error','bad_request'); end if;
 select * into s from public.ai_search_calls where user_id=p_user and request_id=p_request and call_id=p_call for update;
 if not found then return jsonb_build_object('ok',false,'error','bad_request'); end if;
 if not s.measured then update public.ai_monthly_usage set search_queries=greatest(0,search_queries+p_actual-s.queries) where user_id=p_user and period=b.period; update public.ai_search_calls set queries=p_actual,measured=true where user_id=p_user and request_id=p_request and call_id=p_call; end if;
 return jsonb_build_object('ok',true);
end $$;
-- Authenticated users may read their own status; every privileged mutation is service-only.
do $$ declare f record; begin for f in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace and proname in ('billing_period','resolve_entitlement','reconcile_subscription','reserve_ai_budget','record_ai_call','finish_ai_budget','reserve_ai_search_queries','measure_ai_search_queries') loop execute format('revoke all on function %s from public,anon,authenticated',f.signature); execute format('grant execute on function %s to service_role',f.signature); end loop; end $$;
revoke all on function public.account_entitlement() from public,anon; grant execute on function public.account_entitlement() to authenticated;
notify pgrst,'reload schema';
-- Bounded private snapshot and non-search insight cache. Stale revisions fail closed.
create function public.bee_progress(p_user uuid,p_timezone text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare d date; begin
 if not exists(select 1 from pg_timezone_names where name=p_timezone) then raise exception 'Invalid timezone'; end if; d:=(clock_timestamp() at time zone p_timezone)::date;
 return jsonb_build_object('localDate',d,'revision',coalesce((select revision::text from public.bee_context_revisions where user_id=p_user),'0'),
 'totals',(select jsonb_build_object('calories',coalesce(sum(calories),0),'protein',coalesce(sum(protein),0),'carbs',coalesce(sum(carbs),0),'fat',coalesce(sum(fat),0),'count',count(*)) from public.food_logs where user_id=p_user and created_at>=(d::timestamp at time zone p_timezone) and created_at<((d+1)::timestamp at time zone p_timezone)),
 'recentLogTimes',coalesce((select jsonb_agg(created_at) from (select created_at from public.food_logs where user_id=p_user order by created_at desc limit 5) f),'[]'::jsonb),
 'weights',coalesce((select jsonb_agg(to_jsonb(w)) from (select id,weight_kg,original_amount,unit,measured_at,local_date,is_baseline from public.weight_logs where user_id=p_user order by measured_at desc nulls last,created_at desc limit 14) w),'[]'::jsonb));
end $$;
create function public.get_bee_insight(p_user uuid,p_revision text,p_timezone text) returns jsonb language sql security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('text',text,'suggested_pose',pose,'context_revision',context_revision::text,'expires_at',expires_at) from public.bee_insights where user_id=p_user and context_revision::text=p_revision and time_zone=p_timezone and local_date=(clock_timestamp() at time zone p_timezone)::date and expires_at>clock_timestamp() and text is not null;
$$;
create function public.save_bee_insight(p_user uuid,p_revision text,p_timezone text,p_text text,p_pose text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$ begin
 if (public.resolve_entitlement(p_user)->>'tier')<>'pro' or coalesce((select revision::text from public.bee_context_revisions where user_id=p_user),'0') is distinct from p_revision or length(p_text) not between 1 and 1000 or p_text~*'https?://' or not exists(select 1 from pg_timezone_names where name=p_timezone) then raise exception 'Invalid or stale insight'; end if;
 insert into public.bee_insights(user_id,context_revision,local_date,time_zone,text,pose,expires_at) values(p_user,p_revision::bigint,(clock_timestamp() at time zone p_timezone)::date,p_timezone,p_text,p_pose,least(clock_timestamp()+interval '24 hours',(((clock_timestamp() at time zone p_timezone)::date+1)::timestamp at time zone p_timezone))) on conflict(user_id) do update set context_revision=excluded.context_revision,local_date=excluded.local_date,time_zone=excluded.time_zone,text=excluded.text,pose=excluded.pose,expires_at=excluded.expires_at,updated_at=now();
 return public.get_bee_insight(p_user,p_revision,p_timezone);
end $$;
do $$ declare f record; begin for f in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace and proname in ('bee_progress','get_bee_insight','save_bee_insight') loop execute format('revoke all on function %s from public,anon,authenticated',f.signature);execute format('grant execute on function %s to service_role',f.signature);end loop;end $$;
