-- Extend the existing atomic reviewed-food boundary without replacing chat state,
-- ownership, leases, entitlements, idempotency or the food_logs shape.
-- Only service_role may submit validated nutrition evidence; clients confirm IDs.
do $migration$
declare
  definition text;
  old_guard constant text := $old$or coalesce(v_food->>'source','') not in ('web','usda','openfoodfacts','my_food','user_label','ai_estimate') then$old$;
  new_guard constant text := $new$or coalesce(v_food->>'source','') not in ('web','usda','openfoodfacts','my_food','user_label','ai_estimate','trackbing_gist')
        or (v_food->>'source' = 'trackbing_gist' and (
          v_food#>>'{evidence,url}' is distinct from 'https://gist.githubusercontent.com/towtu/893f53e31444ad9757f5c4fb6a7edf67/raw/foods.json'
          or v_food#>>'{evidence,record}' is distinct from 'independent'
          or v_food#>>'{evidence,license}' is distinct from 'operator-provided'
          or length(coalesce(v_food#>>'{evidence,sourceId}','')) not between 1 and 80
          or v_food#>>'{evidence,basis,unit}' is distinct from 'g'
          or v_food#>'{evidence,basis,grams}' is distinct from '100'::jsonb
        )) then$new$;
begin
  select pg_get_functiondef('public.bee_finish_turn(uuid,uuid,uuid,uuid,jsonb)'::regprocedure) into definition;
  -- Fail closed if an earlier migration/function has drifted. All replacement
  -- strings are fixed migration code, never client/model input.
  if (length(definition) - length(replace(definition,old_guard,''))) / length(old_guard) <> 1 then
    raise exception 'Expected exactly one reviewed-food source guard';
  end if;
  execute replace(definition,old_guard,new_guard);
end;
$migration$;
revoke all on function public.bee_finish_turn(uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.bee_finish_turn(uuid,uuid,uuid,uuid,jsonb) to service_role;
