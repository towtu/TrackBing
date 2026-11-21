-- The nutrition columns keep their existing basis. For a per-serving food,
-- store the actual labeled mass separately so both grams and servings work.
alter table public.personal_foods
  add column serving_grams numeric,
  add constraint personal_food_serving_grams check (
    serving_grams is null or (
      default_unit is not distinct from 'serving' and serving_grams > 0 and serving_grams <= 10000
    )
  );

-- PostgreSQL requires recreating the function when an OUT column is added.
-- Keep the existing arguments, prior output columns and authenticated access.
drop function public.lookup_shared_barcode(text);
create function public.lookup_shared_barcode(p_barcode text)
returns table (
  name text, calories numeric, protein numeric, carbs numeric, fat numeric,
  default_unit text, serving_grams numeric
)
language sql stable security definer set search_path = ''
as $$
  select f.name, f.calories, f.protein, f.carbs, f.fat, f.default_unit, f.serving_grams
  from public.barcode_catalog_publisher publisher
  join public.personal_foods f on f.user_id = publisher.user_id
  where auth.uid() is not null and p_barcode ~ '^[0-9]{4,32}$'
    and f.barcode = p_barcode and f.share_barcode;
$$;
revoke all on function public.lookup_shared_barcode(text) from public, anon, authenticated, service_role;
grant execute on function public.lookup_shared_barcode(text) to authenticated;
notify pgrst, 'reload schema';
