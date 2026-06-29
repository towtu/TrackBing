-- Atomic per-period usage increment, called only by the ai-food edge function
-- via the service role. SECURITY DEFINER so it can write ai_usage; execute is
-- revoked from client roles so users cannot inflate/forge their own counts.

create or replace function public.increment_ai_usage(p_user uuid, p_period text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.ai_usage (user_id, period, count)
  values (p_user, p_period, 1)
  on conflict (user_id, period)
  do update set count = public.ai_usage.count + 1;
$$;

revoke all on function public.increment_ai_usage(uuid, text) from public, anon, authenticated;

notify pgrst, 'reload schema';
