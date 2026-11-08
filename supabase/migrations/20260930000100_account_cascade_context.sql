-- Auth erasure can cascade through weight/memory rows after the parent user has
-- disappeared. Do not recreate an owner FK while invalidating those deleted rows.
-- This is additive: no data removal, policy relaxation or new client grant.
create or replace function public.adaptive_bump_context()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_user uuid:=case when tg_op='DELETE' then old.user_id else new.user_id end;
begin
  if not exists(select 1 from auth.users where id=v_user) then return null; end if;
  insert into public.bee_context_revisions(user_id,revision) values(v_user,1)
    on conflict(user_id) do update set revision=public.bee_context_revisions.revision+1;
  update public.bee_insights set text=null,pose=null,expires_at=null where user_id=v_user;
  return null;
end $$;
revoke all on function public.adaptive_bump_context() from public,anon,authenticated;
