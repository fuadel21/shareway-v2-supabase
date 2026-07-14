-- Fix Supabase database linter security alerts.
-- Source: Supabase Performance Security Lints export for project wmkhutsesgtkcgqbctef.
--
-- This migration addresses:
-- - Public tables without RLS enabled.
-- - Public views flagged as SECURITY DEFINER views.
-- - Sensitive session_id exposures caused by RLS being disabled.
--
-- Notes:
-- - public.spatial_ref_sys is owned by PostGIS/Supabase, so it is intentionally excluded.
-- - public.is_admin() is overloaded, so policies call public.is_admin(auth.uid()).
-- - Enable RLS without FORCE RLS to avoid breaking SECURITY DEFINER maintenance functions.

set check_function_bodies = off;

create or replace function public.__sw_apply_lint_policy(
    p_table text,
    p_policy text,
    p_command text,
    p_roles text,
    p_using text,
    p_check text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    ddl text;
begin
    if to_regclass(format('public.%I', p_table)) is null then
        return;
    end if;

    execute format('drop policy if exists %I on public.%I', p_policy, p_table);

    if lower(p_command) = 'insert' then
        ddl := format(
            'create policy %I on public.%I for insert to %s with check (%s)',
            p_policy,
            p_table,
            p_roles,
            coalesce(p_check, p_using)
        );
    elsif lower(p_command) in ('select', 'delete') then
        ddl := format(
            'create policy %I on public.%I for %s to %s using (%s)',
            p_policy,
            p_table,
            p_command,
            p_roles,
            p_using
        );
    else
        ddl := format(
            'create policy %I on public.%I for %s to %s using (%s)%s',
            p_policy,
            p_table,
            p_command,
            p_roles,
            p_using,
            case when p_check is null then '' else format(' with check (%s)', p_check) end
        );
    end if;

    execute ddl;
end;
$$;

do $$
declare
    table_name text;
begin
    foreach table_name in array array[
        'stripe_payments_audit','webhook_logs','audit_logs','user_devices',
        'email_templates','performance_logs','admin_audit_logs','eea_emission_factors',
        'rate_limits','performance_profiles','app_settings','country_configs',
        'notification_preferences','level_config','ride_route_history',
        'performance_metrics','polling_cache','location_cache','v_column_exists',
        'dashboard_activity','location_updates','query_performance_log',
        'load_test_results','error_monitoring','error_alerts','system_health',
        'financial_discrepancies','ecopoints_transactions','user_levels',
        'reward_redemptions','rewards','ride_location_history','chat_reads',
        'refund_logs','user_challenge_progress','challenges','user_streaks'
    ]
    loop
        if to_regclass(format('public.%I', table_name)) is not null then
            execute format('alter table public.%I enable row level security', table_name);

            perform public.__sw_apply_lint_policy(
                table_name,
                'sw_admin_all',
                'all',
                'authenticated',
                'public.is_admin(auth.uid())',
                'public.is_admin(auth.uid())'
            );
        end if;
    end loop;
end $$;

-- Public read-only catalog/config tables used by the app.
do $$
declare
    table_name text;
begin
    foreach table_name in array array[
        'eea_emission_factors','app_settings','country_configs',
        'level_config','rewards','challenges','v_column_exists'
    ]
    loop
        perform public.__sw_apply_lint_policy(
            table_name,
            'sw_public_read',
            'select',
            'anon, authenticated',
            'true',
            null
        );
    end loop;
end $$;

-- User-owned tables with full owner access.
do $$
declare
    table_name text;
begin
    foreach table_name in array array[
        'user_devices','notification_preferences','chat_reads','dashboard_activity'
    ]
    loop
        perform public.__sw_apply_lint_policy(
            table_name,
            'sw_owner_all',
            'all',
            'authenticated',
            'auth.uid() = user_id',
            'auth.uid() = user_id'
        );
    end loop;
end $$;

-- User-owned tables where users should be able to read their own rows.
do $$
declare
    table_name text;
begin
    foreach table_name in array array[
        'stripe_payments_audit','refund_logs','ecopoints_transactions',
        'user_levels','user_streaks','reward_redemptions','user_challenge_progress',
        'rate_limits','performance_logs','performance_metrics',
        'query_performance_log','error_monitoring','location_updates'
    ]
    loop
        perform public.__sw_apply_lint_policy(
            table_name,
            'sw_owner_read',
            'select',
            'authenticated',
            'auth.uid() = user_id',
            null
        );
    end loop;
end $$;

-- User-owned logs/progress tables where the client may create its own rows.
do $$
declare
    table_name text;
begin
    foreach table_name in array array[
        'reward_redemptions','performance_logs','performance_metrics',
        'query_performance_log','error_monitoring','location_updates'
    ]
    loop
        perform public.__sw_apply_lint_policy(
            table_name,
            'sw_owner_insert',
            'insert',
            'authenticated',
            'auth.uid() = user_id',
            'auth.uid() = user_id'
        );
    end loop;
end $$;

-- User-owned mutable tables.
do $$
declare
    table_name text;
begin
    foreach table_name in array array[
        'notification_preferences','user_devices','chat_reads',
        'dashboard_activity','location_updates'
    ]
    loop
        perform public.__sw_apply_lint_policy(
            table_name,
            'sw_owner_update',
            'update',
            'authenticated',
            'auth.uid() = user_id',
            'auth.uid() = user_id'
        );

        perform public.__sw_apply_lint_policy(
            table_name,
            'sw_owner_delete',
            'delete',
            'authenticated',
            'auth.uid() = user_id',
            null
        );
    end loop;
end $$;

-- Ride route history belongs to the passenger.
select public.__sw_apply_lint_policy(
    'ride_route_history',
    'sw_passenger_read',
    'select',
    'authenticated',
    'auth.uid() = passenger_id',
    null
);

-- Ride location history has no user_id. Allow ride participants to read and write location history.
select public.__sw_apply_lint_policy(
    'ride_location_history',
    'sw_ride_participant_read',
    'select',
    'authenticated',
    $policy$
        exists (
            select 1
            from public.rides r
            where r.id = ride_location_history.ride_id
              and (
                r.driver_id = auth.uid()
                or auth.uid() = any(coalesce(r.participant_ids, array[]::uuid[]))
              )
        )
    $policy$,
    null
);

select public.__sw_apply_lint_policy(
    'ride_location_history',
    'sw_ride_participant_insert',
    'insert',
    'authenticated',
    $policy$
        exists (
            select 1
            from public.rides r
            where r.id = ride_location_history.ride_id
              and (
                r.driver_id = auth.uid()
                or auth.uid() = any(coalesce(r.participant_ids, array[]::uuid[]))
              )
        )
    $policy$,
    $policy$
        exists (
            select 1
            from public.rides r
            where r.id = ride_location_history.ride_id
              and (
                r.driver_id = auth.uid()
                or auth.uid() = any(coalesce(r.participant_ids, array[]::uuid[]))
              )
        )
    $policy$
);

-- Switch flagged views to invoker permissions when PostgreSQL supports it.
do $$
declare
    view_name text;
begin
    foreach view_name in array array[
        'internal_sus_activity','audit_financial_discrepancies','v_community_stats',
        'internal_error_monitor','user_ride_history','platform_rating_stats',
        'admin_analytics_summary','internal_financial_alerts','v_eu_grant_report',
        'view_realtime_stress_monitor','internal_stuck_rides'
    ]
    loop
        if to_regclass(format('public.%I', view_name)) is not null then
            execute format('alter view public.%I set (security_invoker = true)', view_name);
        end if;
    end loop;
end $$;

-- Sensitive session_id tables are protected by RLS:
-- - error_monitoring
-- - query_performance_log

drop function if exists public.__sw_apply_lint_policy(text, text, text, text, text, text);
