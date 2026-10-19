-- Operator-approved gifts are not paid subscriptions or renewable receipts.
-- No account is seeded; existing paid plans, diaries and usage remain unchanged.
create table public.pro_access_grants (
 user_id uuid primary key references auth.users(id) on delete cascade,
 starts_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz,
 reason text not null check(length(btrim(reason)) between 1 and 200),
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 revoked_at timestamptz,
 check(isfinite(starts_at) and isfinite(created_at) and isfinite(updated_at)),
 check(expires_at is null or (isfinite(expires_at) and expires_at>starts_at)),
 check(revoked_at is null or (isfinite(revoked_at) and revoked_at>=created_at))
);
alter table public.pro_access_grants enable row level security;
revoke all on public.pro_access_grants from public,anon,authenticated,service_role;
grant select on public.pro_access_grants to authenticated,service_role;
create policy pro_grant_owner on public.pro_access_grants for select to authenticated using(auth.uid()=user_id);

create or replace function public.resolve_entitlement(p_user uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare
 s public.subscriptions%rowtype; a timestamptz; p timestamptz; r timestamptz;
 u public.ai_monthly_usage%rowtype; t text:='basic'; l jsonb;
 preview public.bee_preview_access%rowtype; gift public.pro_access_grants%rowtype;
 access_mode text:='subscription';
begin
 select * into s from public.subscriptions where user_id=p_user and status in ('active','cancelled','grace') and paid_through>clock_timestamp()
 order by case tier when 'pro' then 2 else 1 end desc,paid_through desc limit 1;
 if found then t:=s.tier; end if;
 if t<>'pro' then
  select * into gift from public.pro_access_grants where user_id=p_user and revoked_at is null
   and starts_at<=clock_timestamp() and (expires_at is null or expires_at>clock_timestamp());
  if found then t:='pro'; access_mode:='complimentary'; end if;
 end if;
 select anchor into a from public.billing_accounts where user_id=p_user;
 if a is not null then
  p:=public.billing_period(a,clock_timestamp());
  r:=(a at time zone 'UTC'+make_interval(months=>((extract(year from p at time zone 'UTC')-extract(year from a at time zone 'UTC'))::integer*12+(extract(month from p at time zone 'UTC')-extract(month from a at time zone 'UTC'))::integer)+1)) at time zone 'UTC';
 end if;
 l:=case t when 'pro' then '{"requests":250,"search":50,"insights":30,"input_tokens":800000,"output_tokens":200000}'::jsonb
 when 'plus' then '{"requests":60,"search":0,"insights":0,"input_tokens":160000,"output_tokens":50000}'::jsonb
 else '{"requests":0,"search":0,"insights":0,"input_tokens":0,"output_tokens":0}'::jsonb end;
 if t='basic' then
  access_mode:='basic';
  select * into preview from public.bee_preview_access where user_id=p_user and created_at<=clock_timestamp() and expires_at>clock_timestamp();
  if found then
   -- Reuse Pro's capability checks, while identifying this as unpaid evaluation.
   t:='pro'; access_mode:='private_preview'; p:=preview.created_at; r:=preview.expires_at;
   l:='{"requests":20,"search":6,"insights":3,"input_tokens":350000,"output_tokens":285000}'::jsonb;
  end if;
 end if;
 select * into u from public.ai_monthly_usage where user_id=p_user and period=p;
 return jsonb_build_object('tier',t,'access_mode',access_mode,'access_expires_at',case when access_mode='complimentary' then gift.expires_at else null end,'capabilities',jsonb_build_object(
 'manual_tracking',true,'ai_food_assist',t<>'basic','google_food_search',t='pro','web_food_search',t='pro','read_nutrition_label',t<>'basic','food_suggestions',t<>'basic','bee_chat',t='pro',
 'bee_weight_actions',t='pro','bee_goal_proposal',t='pro','bee_memory_write',t='pro','bee_dashboard_insight',t='pro'),
 'period',p,'reset_at',r,'limits',l,
 'used',jsonb_build_object('requests',coalesce(u.requests,0),'search',coalesce(u.search_queries,0),'insights',coalesce(u.insights,0),'input_tokens',coalesce(u.input_tokens,0),'output_tokens',coalesce(u.output_tokens,0)),
 'remaining',jsonb_build_object('requests',greatest(0,(l->>'requests')::int-coalesce(u.requests,0)),
 'search',greatest(0,(l->>'search')::int-coalesce(u.search_queries,0)),
 'insights',greatest(0,(l->>'insights')::int-coalesce(u.insights,0)),
 'input_tokens',greatest(0,(l->>'input_tokens')::bigint-coalesce(u.input_tokens,0)-coalesce(u.reserved_input,0)),
 'output_tokens',greatest(0,(l->>'output_tokens')::bigint-coalesce(u.output_tokens,0)-coalesce(u.reserved_output,0))),
 'duplicate_subscriptions',(select count(*)>1 from public.subscriptions where user_id=p_user and status in ('active','cancelled','grace') and paid_through>clock_timestamp()));
end $$;
revoke all on function public.resolve_entitlement(uuid) from public,anon,authenticated;
grant execute on function public.resolve_entitlement(uuid) to service_role;

-- Service-only grants serialize with paid reconciliation and quota reservations.
create function public.grant_complimentary_pro(p_user uuid,p_expires_at timestamptz,p_reason text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
 v_now timestamptz; v_anchor timestamptz; v_preview timestamptz;
begin
 if p_user is null or p_reason is null or length(btrim(p_reason)) not between 1 and 200 then
  raise exception 'invalid grant';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('billing:'||p_user::text,0));
 v_now:=clock_timestamp();
 if p_expires_at is not null and (not isfinite(p_expires_at) or p_expires_at<=v_now) then
  raise exception 'invalid grant';
 end if;
 if not exists(select 1 from auth.users a join public.user_goals g on g.user_id=a.id
  where a.id=p_user and a.email_confirmed_at is not null and g.age>=18) then
  raise exception 'verified adult account required';
 end if;
 select anchor into v_anchor from public.billing_accounts where user_id=p_user;
 select created_at into v_preview from public.bee_preview_access
  where user_id=p_user and created_at<=v_now and expires_at>v_now;
 -- Do not silently abandon a preview's used/reserved credits under another anchor.
 if v_anchor is not null and v_preview is not null and public.billing_period(v_anchor,v_now)<>v_preview
  and exists(select 1 from public.ai_monthly_usage where user_id=p_user and period=v_preview) then
  raise exception 'preview usage period mismatch';
 end if;
 insert into public.billing_accounts(user_id,anchor)
 values(p_user,coalesce(v_anchor,(select created_at from public.bee_preview_access where user_id=p_user),v_now))
 on conflict(user_id) do nothing;
 insert into public.pro_access_grants(user_id,starts_at,expires_at,reason,created_at,updated_at)
 values(p_user,v_now,p_expires_at,btrim(p_reason),v_now,v_now)
 on conflict(user_id) do update set
  expires_at=case when pro_access_grants.revoked_at is not null then excluded.expires_at
   when pro_access_grants.expires_at is null or excluded.expires_at is null then null
   else greatest(pro_access_grants.expires_at,excluded.expires_at) end,
  reason=excluded.reason,updated_at=v_now,revoked_at=null;
 return public.resolve_entitlement(p_user);
end $$;

create function public.revoke_complimentary_pro(p_user uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if p_user is null then raise exception 'invalid grant'; end if;
 perform pg_advisory_xact_lock(hashtextextended('billing:'||p_user::text,0));
 update public.pro_access_grants set revoked_at=coalesce(revoked_at,clock_timestamp()),updated_at=clock_timestamp()
 where user_id=p_user;
 return public.resolve_entitlement(p_user);
end $$;
revoke all on function public.grant_complimentary_pro(uuid,timestamptz,text) from public,anon,authenticated;
revoke all on function public.revoke_complimentary_pro(uuid) from public,anon,authenticated;
grant execute on function public.grant_complimentary_pro(uuid,timestamptz,text) to service_role;
grant execute on function public.revoke_complimentary_pro(uuid) to service_role;
notify pgrst,'reload schema';
