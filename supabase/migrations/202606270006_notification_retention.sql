-- Notification retention helpers.
-- Keeps important/pinned notifications, and allows scheduled cleanup from Supabase cron or manual admin execution.

create or replace function public.purge_old_notifications(days_to_keep integer default 90)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer;
begin
  if days_to_keep is null or days_to_keep < 30 then
    days_to_keep := 30;
  end if;

  delete from public.notifications
  where created_at < now() - make_interval(days => days_to_keep)
    and is_pinned = false
    and priority <> 'critical';

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

create or replace function public.archive_read_notifications(days_to_keep integer default 180)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer;
begin
  if days_to_keep is null or days_to_keep < 30 then
    days_to_keep := 30;
  end if;

  delete from public.notifications
  where is_read = true
    and read_at is not null
    and read_at < now() - make_interval(days => days_to_keep)
    and is_pinned = false
    and priority not in ('high', 'critical');

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.purge_old_notifications(integer) from public;
revoke all on function public.archive_read_notifications(integer) from public;

grant execute on function public.purge_old_notifications(integer) to authenticated;
grant execute on function public.archive_read_notifications(integer) to authenticated;
