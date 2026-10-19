-- Explicit operator-granted evaluation. Never creates a subscription or receipt.
-- One fixed seven-day grant/period; expiration cannot reset its usage allowance.
create table public.bee_preview_access (
 user_id uuid primary key references auth.users(id) on delete cascade,
 created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null default clock_timestamp()+interval '7 days',
 check(isfinite(created_at) and isfinite(expires_at) and
       expires_at>created_at and expires_at<=created_at+interval '7 days 1 second')
);
alter table public.bee_preview_access enable row level security;
revoke all on public.bee_preview_access from public,anon,authenticated;
grant select on public.bee_preview_access to authenticated;
grant all on public.bee_preview_access to service_role;
create policy bee_preview_owner on public.bee_preview_access for select to authenticated using(auth.uid()=user_id);

create or replace function public.resolve_entitlement(p_user uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare
 s public.subscriptions%rowtype; a timestamptz; p timestamptz; r timestamptz;
 u public.ai_monthly_usage%rowtype; t text:='basic'; l jsonb;
 preview public.bee_preview_access%rowtype; access_mode text:='subscription';
begin
 select * into s from public.subscriptions where user_id=p_user and status in ('active','cancelled','grace') and paid_through>clock_timestamp()
 order by case tier when 'pro' then 2 else 1 end desc,paid_through desc limit 1;
 if found then t:=s.tier; end if;
 select anchor into a from public.billing_accounts where user_id=p_user;
 if a is not null then
  p:=public.billing_period(a,clock_timestamp());
  r:=(a at time zone 'UTC'+make_interval(months=>((extract(year from p at time zone 'UTC')-extract(year from a at time zone 'UTC'))::integer*12+(extract(month from p at time zone 'UTC')-extract(month from a at time zone 'UTC'))::integer)+1)) at time zone 'UTC';
 end if;
 l:=case t when 'pro' then '{"requests":250,"search":50,"insights":30,"input_tokens":800000,"output_tokens":200000}'::jsonb
 when 'plus' then '{"requests":60,"search":10,"insights":0,"input_tokens":160000,"output_tokens":50000}'::jsonb
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
 return jsonb_build_object('tier',t,'access_mode',access_mode,'capabilities',jsonb_build_object(
 'manual_tracking',true,'ai_food_assist',t<>'basic','google_food_search',t<>'basic','bee_chat',t='pro',
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
notify pgrst,'reload schema';
