-- Role assignment is separate from application data. Only a database operator
-- can set the one publisher to a verified account's UUID.
create table public.barcode_catalog_publisher (
  singleton boolean primary key default true check (singleton),
  user_id uuid not null references auth.users(id) on delete cascade
);
alter table public.barcode_catalog_publisher enable row level security;
revoke all on table public.barcode_catalog_publisher from public, anon, authenticated, service_role;

alter table public.personal_foods add column share_barcode boolean not null default false;
alter table public.personal_foods add constraint shareable_barcode
  check (not share_barcode or (
    barcode is not null and default_unit is not null and default_unit in ('g', 'serving') and ai_estimated is false
  ));

create function public.can_share_barcodes()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.barcode_catalog_publisher where user_id = auth.uid()
  );
$$;

create function public.enforce_barcode_publisher()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.share_barcode and not (
    new.user_id = auth.uid() and public.can_share_barcodes()
  ) is true then
    raise exception 'Only the TrackBing barcode publisher may share a food.' using errcode = '42501';
  end if;
  return new;
end
$$;
create trigger enforce_barcode_publisher before insert or update on public.personal_foods
  for each row execute function public.enforce_barcode_publisher();

create function public.lookup_shared_barcode(p_barcode text)
returns table (name text, calories numeric, protein numeric, carbs numeric, fat numeric, default_unit text)
language sql stable security definer set search_path = ''
as $$
  select f.name, f.calories, f.protein, f.carbs, f.fat, f.default_unit
  from public.barcode_catalog_publisher publisher
  join public.personal_foods f on f.user_id = publisher.user_id
  where auth.uid() is not null and p_barcode ~ '^[0-9]{4,32}$'
    and f.barcode = p_barcode and f.share_barcode;
$$;

revoke all on function public.can_share_barcodes() from public, anon, authenticated, service_role;
revoke all on function public.enforce_barcode_publisher() from public, anon, authenticated, service_role;
revoke all on function public.lookup_shared_barcode(text) from public, anon, authenticated, service_role;
grant execute on function public.can_share_barcodes(), public.lookup_shared_barcode(text) to authenticated;
notify pgrst, 'reload schema';
