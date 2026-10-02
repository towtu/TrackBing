-- Forward-only library creation. Existing manual foods, recipes and diaries
-- remain authoritative. Google-grounded values are not permissible inputs.
-- Cookbook already records fractions of a whole recipe with this unit. Keep
-- that existing representation rather than fabricating grams or servings.
alter table public.food_logs drop constraint launch_food_unit;
alter table public.food_logs add constraint launch_food_unit check((serving_unit is null and serving_size is null) or (serving_unit is not null and serving_unit in ('g','ml','oz','tsp','tbsp','cup','serving','piece','bar','pack','recipe'))) not valid;
alter table public.recipes
  add column servings integer not null default 1 check(servings between 1 and 20),
  add column instructions jsonb not null default '[]'::jsonb,
  add column bee_action_id uuid,
  add column bee_provenance jsonb;
alter table public.personal_foods add column bee_action_id uuid, add column bee_provenance jsonb;
alter table public.recipes add constraint recipe_creation_owner foreign key(user_id,bee_action_id) references public.bee_pending_actions(user_id,id);
alter table public.personal_foods add constraint personal_creation_owner foreign key(user_id,bee_action_id) references public.bee_pending_actions(user_id,id);
create unique index recipe_creation_once on public.recipes(user_id,bee_action_id) where bee_action_id is not null;
create unique index personal_creation_once on public.personal_foods(user_id,bee_action_id) where bee_action_id is not null;

create function public.validate_recipe_instructions() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if jsonb_typeof(new.instructions) is distinct from 'array' or jsonb_array_length(new.instructions)>8
    or exists(select 1 from jsonb_array_elements(new.instructions) x where jsonb_typeof(x)<>'string' or length(btrim(x#>>'{}')) not between 1 and 300 or (x#>>'{}') ~ '[[:cntrl:]]') then
    raise exception 'Use up to eight plain recipe steps' using errcode='22023';
  end if;
  return new;
end $$;
create trigger validate_recipe_instructions before insert or update of instructions on public.recipes for each row execute function public.validate_recipe_instructions();
revoke all on function public.validate_recipe_instructions() from public,anon,authenticated;

alter table public.bee_pending_actions add column creation jsonb;
alter table public.bee_pending_actions drop constraint bee_pending_actions_action_kind_check;
alter table public.bee_pending_actions add constraint bee_pending_actions_action_kind_check check(action_kind in ('food','weight','goal','personal_food','recipe'));
alter table public.bee_pending_actions drop constraint adaptive_action_payload;
alter table public.bee_pending_actions add constraint adaptive_action_payload check(
  (action_kind='food' and weight is null and goal is null and creation is null) or
  (action_kind='weight' and jsonb_typeof(weight)='object' and goal is null and creation is null) or
  (action_kind='goal' and jsonb_typeof(goal)='object' and weight is null and creation is null) or
  (action_kind in ('personal_food','recipe') and weight is null and goal is null and jsonb_typeof(creation)='object' and creation->>'kind'=action_kind));

-- Independent arithmetic boundary: reconstruct the existing Cookbook snapshot
-- from the retained original basis, not rounded model/assistant text.
create function public.bee_library_ingredient(f jsonb) returns jsonb
language plpgsql immutable set search_path=public,pg_temp as $$
declare b jsonb:=f#>'{evidence,basis}'; n jsonb:=b->'nutrients'; e jsonb:=f->'evidence'; s jsonb;
  g numeric; amount numeric; factor numeric; ratio numeric; u text; k text; vals jsonb:='{}';
begin
  if jsonb_typeof(f) is distinct from 'object' or coalesce(f->>'source','') not in ('usda','openfoodfacts','my_food','user_label','trackbing_gist')
    or coalesce(e->>'record','') not in ('independent','user_owned') or f->>'name' is distinct from e->>'identity'
    or jsonb_typeof(f#>'{portion,amount}') is distinct from 'number' or not (f#>>'{portion,amount}')::numeric between 0.01 and 10000
    or f->'portion' is distinct from f#>'{query,portion}' then return null; end if;
  s:=(e->>'excerpt')::jsonb;
  if s->'basis' is distinct from b or s->>'identity' is distinct from e->>'identity' or s->>'url' is distinct from e->>'url' or s->>'sourceId' is distinct from e->>'sourceId' then return null; end if;
  if (f->>'source'='usda' and (e->>'record'<>'independent' or e->>'url' is distinct from 'https://fdc.nal.usda.gov/food-details/'||(e->>'sourceId')||'/nutrients'))
    or (f->>'source'='openfoodfacts' and (e->>'record'<>'independent' or e->>'url' is distinct from 'https://world.openfoodfacts.org/product/'||(e->>'sourceId')))
    or (f->>'source' in ('my_food','user_label') and (e->>'record'<>'user_owned' or e->>'url' is distinct from ''))
    or (f->>'source'='trackbing_gist' and (e->>'record'<>'independent' or e->>'url' is distinct from 'https://gist.githubusercontent.com/towtu/893f53e31444ad9757f5c4fb6a7edf67/raw/foods.json' or b->'grams' is distinct from '100'::jsonb or b->>'unit'<>'g' or
      n->'calories' is distinct from s#>'{data,c}' or n->'protein' is distinct from s#>'{data,p}' or n->'carbs' is distinct from s#>'{data,cb}' or n->'fat' is distinct from s#>'{data,f}' or s#>>'{data,name}' is distinct from f->>'name')) then return null; end if;
  g:=(b->>'grams')::numeric;
  if g is not null then
    if not g between 0.01 and 20000 or jsonb_typeof(f->'grams') is distinct from 'number' or not (f->>'grams')::numeric between 0.01 and 10000 then return null; end if;
    u:='g'; amount:=(f->>'grams')::numeric; factor:=100/g; ratio:=amount/g;
    if f#>>'{portion,unit}' in ('g','oz') then
      if abs(amount-(f#>>'{portion,amount}')::numeric*case when f#>>'{portion,unit}'='oz' then 28.349523125 else 1 end)>0.00001 then return null; end if;
    elsif f#>>'{portion,unit}'=b->>'unit' and (b->>'count')::numeric>0 then
      if abs(amount-g*(f#>>'{portion,amount}')::numeric/(b->>'count')::numeric)>0.00001 then return null; end if;
    elsif f#>>'{portion,unit}'='ml' and (b->>'milliliters')::numeric>0 then
      if abs(amount-g*(f#>>'{portion,amount}')::numeric/(b->>'milliliters')::numeric)>0.00001 then return null; end if;
    else return null; end if;
  elsif b->>'unit'='ml' and f#>>'{portion,unit}'='ml' and (b->>'milliliters')::numeric>0 then
    u:='ml';amount:=(f#>>'{portion,amount}')::numeric;factor:=100/(b->>'milliliters')::numeric;ratio:=amount/(b->>'milliliters')::numeric;
  elsif f#>>'{portion,unit}'=b->>'unit' and (b->>'count')::numeric>0 then
    u:='serving';amount:=(f#>>'{portion,amount}')::numeric;factor:=1/(b->>'count')::numeric;ratio:=amount/(b->>'count')::numeric;
  else return null; end if;
  if amount is null or ratio is null or factor is null or not amount between 0.01 and 10000 or ratio<=0 or factor<=0 then return null; end if;
  foreach k in array array['calories','protein','carbs','fat'] loop
    if jsonb_typeof(n->k) is distinct from 'number' or not (n->>k)::numeric between 0 and 100000
      or jsonb_typeof(f->k) is distinct from 'number' or abs((f->>k)::numeric-round((n->>k)::numeric*ratio,case when k='calories' then 0 else 1 end))>0.00001 then return null; end if;
    vals:=vals||jsonb_build_object(k,round((n->>k)::numeric*factor,6));
  end loop;
  return jsonb_build_object('name',f->>'name','brands',coalesce(f#>>'{query,brand}',''),'weight',amount,'unit',u,'default_unit',u,'nutriments',
    jsonb_build_object('energy-kcal_100g',vals->'calories','proteins_100g',vals->'protein','carbohydrates_100g',vals->'carbs','fat_100g',vals->'fat'));
exception when others then return null;
end $$;
revoke all on function public.bee_library_ingredient(jsonb) from public,anon,authenticated;

create function public.bee_validate_creation(c jsonb) returns boolean
language plpgsql immutable set search_path=public,pg_temp as $$
declare i jsonb; f jsonb; candidate jsonb; vals jsonb; count_foods integer; pos integer:=0; k text;
  totals jsonb:='{"calories":0,"protein":0,"carbs":0,"fat":0}'; factor numeric;
begin
  if jsonb_typeof(c) is distinct from 'object' or coalesce(c->>'kind','') not in ('personal_food','recipe') or public.bee_contains_grounding(c) or length(btrim(coalesce(c->>'name',''))) not between 1 and 160 or (c->>'name') ~ '[[:cntrl:]]' then return false; end if;
  if c->>'kind'='personal_food' then
    i:=public.bee_library_ingredient(c->'food'); if i is null or c->>'name' is distinct from i->>'name' or c->>'defaultUnit' is distinct from i->>'default_unit' then return false; end if;
    vals:=jsonb_build_object('calories',i#>'{nutriments,energy-kcal_100g}','protein',i#>'{nutriments,proteins_100g}','carbs',i#>'{nutriments,carbohydrates_100g}','fat',i#>'{nutriments,fat_100g}');
    return coalesce(c->'nutrients'=vals,false);
  end if;
  if c->>'kind'<>'recipe' or jsonb_typeof(c->'servings') is distinct from 'number' or not (c->>'servings')::numeric between 1 and 20 or (c->>'servings')::numeric<>trunc((c->>'servings')::numeric)
    or jsonb_typeof(c->'foods') is distinct from 'array' or jsonb_typeof(c->'ingredients') is distinct from 'array' or jsonb_typeof(c->'instructions') is distinct from 'array' then return false; end if;
  count_foods:=jsonb_array_length(c->'foods');
  if count_foods not between 1 and 8 or jsonb_array_length(c->'ingredients')<>count_foods or jsonb_array_length(c->'instructions') not between 1 and 8
    or exists(select 1 from jsonb_array_elements(c->'instructions') x where jsonb_typeof(x)<>'string' or length(btrim(x#>>'{}')) not between 1 and 300 or (x#>>'{}') ~ '[[:cntrl:]]') then return false; end if;
  for f in select value from jsonb_array_elements(c->'foods') loop
    i:=public.bee_library_ingredient(f);candidate:=c->'ingredients'->pos;
    if i is null or i is distinct from candidate then return false; end if;
    factor:=(i->>'weight')::numeric/case when i->>'unit'='serving' then 1 else 100 end;
    vals:=jsonb_build_object('calories',i#>'{nutriments,energy-kcal_100g}','protein',i#>'{nutriments,proteins_100g}','carbs',i#>'{nutriments,carbohydrates_100g}','fat',i#>'{nutriments,fat_100g}');
    foreach k in array array['calories','protein','carbs','fat'] loop totals:=jsonb_set(totals,array[k],to_jsonb((totals->>k)::numeric+(vals->>k)::numeric*factor)); end loop;
    pos:=pos+1;
  end loop;
  foreach k in array array['calories','protein','carbs','fat'] loop
    if jsonb_typeof(c#>array['totals',k]) is distinct from 'number' or not (c#>>array['totals',k])::numeric between 0 and 100000 or abs((c#>>array['totals',k])::numeric-round((totals->>k)::numeric,6))>0.00001 then return false; end if;
  end loop;
  return true;
exception when others then return false;
end $$;
revoke all on function public.bee_validate_creation(jsonb) from public,anon,authenticated;

create function public.protect_bee_library_provenance() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if current_user in ('authenticated','anon') then
    if tg_op='INSERT' and (new.bee_action_id is not null or new.bee_provenance is not null) then raise exception 'Bee provenance is server-owned' using errcode='42501'; end if;
    if tg_op='UPDATE' then
      if new.bee_action_id is distinct from old.bee_action_id or new.bee_provenance is distinct from old.bee_provenance then raise exception 'Bee provenance is server-owned' using errcode='42501'; end if;
      if old.bee_action_id is not null and (to_jsonb(new)-'bee_provenance') is distinct from (to_jsonb(old)-'bee_provenance') then new.bee_provenance:=old.bee_provenance||jsonb_build_object('user_edited',true); end if;
    end if;
  end if;
  return new;
end $$;
revoke all on function public.protect_bee_library_provenance() from public,anon,authenticated;
create trigger protect_bee_recipe_provenance before insert or update on public.recipes for each row execute function public.protect_bee_library_provenance();
create trigger protect_bee_personal_provenance before insert or update on public.personal_foods for each row execute function public.protect_bee_library_provenance();

-- Extend the existing reviewed-action state machine using fixed, fail-closed
-- migration anchors. Never execute client/model SQL. Keep all existing locking,
-- ownership, lease, tier, replay, expiry and summary behavior in this function.
do $migration$
declare definition text; old text; replacement text; replacements jsonb;
begin
  select pg_get_functiondef('public.bee_finish_turn(uuid,uuid,uuid,uuid,jsonb)'::regprocedure) into definition;
  replacements:=jsonb_build_array(
    jsonb_build_array('v_goal jsonb:=p_outcome->''goal_draft'';', 'v_goal jsonb:=p_outcome->''goal_draft''; v_creation jsonb:=p_outcome->''creation_draft'';'),
    jsonb_build_array($old$if v_action.action_kind='food' then
        insert$old$, $new$if v_action.action_kind in ('personal_food','recipe') then
          if not coalesce(public.bee_validate_creation(v_action.creation),false) then raise exception 'Invalid library creation'; end if;
          if v_action.action_kind='personal_food' then
            insert into public.personal_foods(user_id,name,calories,protein,carbs,fat,default_unit,ai_estimated,bee_action_id,bee_provenance)
              values(p_user,v_action.creation->>'name',(v_action.creation#>>'{nutrients,calories}')::numeric,(v_action.creation#>>'{nutrients,protein}')::numeric,(v_action.creation#>>'{nutrients,carbs}')::numeric,(v_action.creation#>>'{nutrients,fat}')::numeric,v_action.creation->>'defaultUnit',false,v_action.id,jsonb_build_object('creation',v_action.creation,'review_version',v_action.review_version)) returning id::text into v_log_id;
          else
            insert into public.recipes(user_id,name,ingredients,servings,instructions,bee_action_id,bee_provenance)
              values(p_user,v_action.creation->>'name',v_action.creation->'ingredients',(v_action.creation->>'servings')::integer,v_action.creation->'instructions',v_action.id,jsonb_build_object('creation',v_action.creation,'review_version',v_action.review_version)) returning id::text into v_log_id;
          end if;
          update public.bee_pending_actions set status='confirmed',saved_action_id=v_log_id::uuid where user_id=p_user and id=v_action.id;
        elsif v_action.action_kind='food' then
        insert$new$),
    jsonb_build_array($old$else 'Goal updated.' end$old$, $new$when v_action.action_kind='recipe' then 'Recipe saved to Cookbook. Nothing added to your diary.' when v_action.action_kind='personal_food' then 'Food saved to My Foods. Nothing added to your diary.' else 'Goal updated.' end$new$),
    jsonb_build_array('v_food := null; v_weight:=null; v_goal:=null;', 'v_food := null; v_weight:=null; v_goal:=null; v_creation:=null;'),
    jsonb_build_array($old$if p_outcome->>'invalidate_pending' = 'true' or$old$, $new$if (v_creation is not null and v_creation<>'null'::jsonb) or p_outcome->>'invalidate_pending' = 'true' or$new$),
    jsonb_build_array($old$if v_kind in ('message','food_assist') then
      insert$old$, $new$if v_creation is not null and v_creation<>'null'::jsonb then
      if v_kind not in ('message','food_assist') or (public.resolve_entitlement(p_user)->>'tier')<>'pro' or
        (v_food is not null and v_food<>'null'::jsonb) or (v_weight is not null and v_weight<>'null'::jsonb) or (v_goal is not null and v_goal<>'null'::jsonb) or not coalesce(public.bee_validate_creation(v_creation),false) then raise exception 'Invalid library creation' using errcode='22023'; end if;
      if v_creation->>'kind'='personal_food' and v_creation#>>'{food,source}'='user_label' and v_creation#>>'{food,evidence,excerpt}' is not null and
        ((v_creation#>>'{food,evidence,excerpt}')::jsonb#>>'{data,userText}') is distinct from v_turn.command->>'text' then raise exception 'Invalid library creation label' using errcode='22023'; end if;
      v_action_kind:=v_creation->>'kind';
      insert into public.bee_pending_actions(user_id,thread_id,review_version,food,action_kind,creation,local_date,time_zone,origin_tier,expires_at)
        values(p_user,p_thread,v_thread.version+1,'{}',v_action_kind,v_creation,(v_now at time zone v_turn.time_zone)::date,v_turn.time_zone,'pro',v_now+interval '30 minutes') returning * into v_action;
      v_state:=jsonb_set(v_state,'{awaiting}','"review"');
    end if;
    if v_kind in ('message','food_assist') then
      insert$new$)
  );
  for old,replacement in select x->>0,x->>1 from jsonb_array_elements(replacements) x loop
    -- The reset anchor deliberately occurs twice, for clear_chat/memory_clear.
    if (length(definition)-length(replace(definition,old,'')))/length(old) <> (case when old='v_food := null; v_weight:=null; v_goal:=null;' then 2 else 1 end) then raise exception 'Library creation migration anchor drift: %',old; end if;
    definition:=replace(definition,old,replacement);
  end loop;
  old:='and not exists(select 1 from public.weight_logs w where w.user_id = p_user and w.bee_action_id = a.id)';
  replacement:=old||' and not exists(select 1 from public.recipes r where r.user_id=p_user and r.bee_action_id=a.id) and not exists(select 1 from public.personal_foods f where f.user_id=p_user and f.bee_action_id=a.id)';
  if position(old in definition)=0 then raise exception 'Expected library retention guard'; end if;
  execute replace(definition,old,replacement);
  select pg_get_functiondef('public.bee_prune_history(uuid)'::regprocedure) into definition;
  if position(old in definition)=0 then raise exception 'Expected library pruning guard'; end if;
  execute replace(definition,old,replacement);
end $migration$;
revoke all on function public.bee_finish_turn(uuid,uuid,uuid,uuid,jsonb), public.bee_prune_history(uuid) from public,anon,authenticated;
grant execute on function public.bee_finish_turn(uuid,uuid,uuid,uuid,jsonb), public.bee_prune_history(uuid) to service_role;

-- Existing owner-only RLS policies and restricted grants remain in place. All
-- new indirect action references are composite owner FKs. Context revisions
-- also invalidate dashboard wording after a library edit/delete.
create trigger recipe_context_revision after insert or update or delete on public.recipes for each row execute function public.adaptive_bump_context();
