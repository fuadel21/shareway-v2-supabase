-- ShareWay notifications hardening v1
-- Enables realtime publication and prevents direct client execution of internal notification RPCs.

-- Realtime: allow clients subscribed through Supabase Realtime to receive notification INSERT/UPDATE events.
do $$
begin
  if to_regclass('public.notifications') is not null then
    begin
      alter publication supabase_realtime add table public.notifications;
    exception
      when duplicate_object then null;
      when undefined_object then
        raise warning '[notifications] supabase_realtime publication does not exist in this environment';
    end;
  end if;
end;
$$;

-- Security: this function is for database triggers/server flows, not direct client calls.
-- SECURITY DEFINER would otherwise allow arbitrary notification creation if executable by public roles.
do $$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'create_system_notification'
  ) then
    revoke all on function public.create_system_notification(uuid, uuid, text, text, text, text, text, text, text, jsonb) from public;
    revoke all on function public.create_system_notification(uuid, uuid, text, text, text, text, text, text, text, jsonb) from anon;
    revoke all on function public.create_system_notification(uuid, uuid, text, text, text, text, text, text, text, jsonb) from authenticated;
    revoke all on function public.create_system_notification(uuid, uuid, text, text, text, text, text, text, text, jsonb) from service_role;
  end if;
end;
$$;

-- Keep trigger functions internal as well. Triggers can still execute them.
do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'notify_review_inserted') then
    revoke all on function public.notify_review_inserted() from public, anon, authenticated, service_role;
  end if;

  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'notify_message_inserted') then
    revoke all on function public.notify_message_inserted() from public, anon, authenticated, service_role;
  end if;

  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'notify_booking_status_changed') then
    revoke all on function public.notify_booking_status_changed() from public, anon, authenticated, service_role;
  end if;

  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'notify_ride_cancelled') then
    revoke all on function public.notify_ride_cancelled() from public, anon, authenticated, service_role;
  end if;
end;
$$;
