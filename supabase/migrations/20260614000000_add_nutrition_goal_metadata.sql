alter table public.user_goals
  add column if not exists goal_mode text,
  add column if not exists goal_rate numeric,
  add column if not exists unit_system text;

alter table public.user_goals
  drop constraint if exists user_goals_goal_mode_check,
  add constraint user_goals_goal_mode_check
    check (
      goal_mode is null
      or goal_mode in (
        'estimated_rate',
        'maintenance',
        'custom_calories',
        'minor_maintenance',
        'legacy_custom'
      )
    );

alter table public.user_goals
  drop constraint if exists user_goals_goal_rate_check,
  add constraint user_goals_goal_rate_check
    check (goal_rate is null or goal_rate between -0.01 and 0.005);

alter table public.user_goals
  drop constraint if exists user_goals_unit_system_check,
  add constraint user_goals_unit_system_check
    check (unit_system is null or unit_system in ('metric', 'imperial'));
