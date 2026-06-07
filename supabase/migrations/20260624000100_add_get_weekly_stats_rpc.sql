-- Single-round-trip weekly stats aggregate.
--
-- The stats screen previously issued three separate queries (goal, summaries,
-- today's logs). This function returns everything in one call as a JSON object,
-- cutting network round-trips and giving a consistent snapshot.
--
-- SECURITY INVOKER: runs as the caller, so RLS applies and auth.uid() resolves
-- to the logged-in user. Every sub-query is also explicitly scoped to
-- auth.uid(), so a user can only ever read their own data.
--
-- p_today_start: the client's local midnight (ISO timestamp). Passed in so the
-- "today" bucket matches the user's timezone rather than the database's.

create or replace function public.get_weekly_stats(p_today_start timestamptz)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'calorie_target', (
      select calorie_target
      from public.user_goals
      where user_id = auth.uid()
      limit 1
    ),
    'summaries', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'date', date,
          'calories', calories,
          'protein', protein,
          'carbs', carbs,
          'fat', fat,
          'meal_count', meal_count
        )
        order by date desc
      )
      from public.daily_summaries
      where user_id = auth.uid()
    ), '[]'::jsonb),
    'today', (
      select jsonb_build_object(
        'calories', coalesce(sum(calories), 0),
        'protein', coalesce(sum(protein), 0),
        'carbs', coalesce(sum(carbs), 0),
        'fat', coalesce(sum(fat), 0),
        'count', count(*)
      )
      from public.food_logs
      where user_id = auth.uid()
        and created_at >= p_today_start
    )
  );
$$;

grant execute on function public.get_weekly_stats(timestamptz) to authenticated;
