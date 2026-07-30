-- Optional numeric barcodes for owner-created foods.
alter table public.personal_foods
  add column if not exists barcode text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'personal_foods_barcode_digits'
      and conrelid = 'public.personal_foods'::regclass
  ) then
    alter table public.personal_foods
      add constraint personal_foods_barcode_digits
      check (barcode is null or barcode ~ '^[0-9]{4,32}$');
  end if;
end
$$;

create unique index if not exists personal_foods_user_barcode_unique
  on public.personal_foods (user_id, barcode)
  where barcode is not null;

alter table public.personal_foods enable row level security;

drop policy if exists "Users manage own rows" on public.personal_foods;
create policy "Users manage own rows"
  on public.personal_foods
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

notify pgrst, 'reload schema';
