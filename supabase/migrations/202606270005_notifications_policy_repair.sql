-- ShareWay notifications policy repair v1
-- Idempotent repair for environments where 202606270002_notifications.sql was already applied.

create or replace function public.is_current_user_admin()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_has_is_admin boolean := false;
  v_has_role boolean := false;
  v_result boolean := false;
begin
  if v_uid is null or to_regclass('public.profiles') is null then
    return false;
  end if;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'is_admin'
  ) into v_has_is_admin;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'role'
  ) into v_has_role;

  if v_has_is_admin then
    execute 'select coalesce(is_admin, false) from public.profiles where id = $1 limit 1'
    using v_uid
    into v_result;

    if coalesce(v_result, false) then
      return true;
    end if;
  end if;

  if v_has_role then
    execute 'select lower(coalesce(role, '''')) in (''admin'', ''super_admin'') from public.profiles where id = $1 limit 1'
    using v_uid
    into v_result;

    if coalesce(v_result, false) then
      return true;
    end if;
  end if;

  return false;
exception when others then
  raise warning '[notifications] admin helper fallback: %', sqlerrm;
  return false;
end;
$$;

grant execute on function public.is_current_user_admin() to authenticated;

do $$
begin
  if to_regclass('public.notifications') is null then
    raise notice '[notifications] table does not exist; policy repair skipped';
    return;
  end if;

  execute 'alter table public.notifications enable row level security';

  execute 'drop policy if exists "Users can read own notifications" on public.notifications';
  execute 'create policy "Users can read own notifications" on public.notifications for select to authenticated using (auth.uid() = user_id)';

  execute 'drop policy if exists "Admins can read all notifications" on public.notifications';
  execute 'create policy "Admins can read all notifications" on public.notifications for select to authenticated using (public.is_current_user_admin())';

  execute 'drop policy if exists "Users can update own notifications" on public.notifications';
  execute 'create policy "Users can update own notifications" on public.notifications for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id)';

  execute 'drop policy if exists "Users can delete own notifications" on public.notifications';
  execute 'create policy "Users can delete own notifications" on public.notifications for delete to authenticated using (auth.uid() = user_id)';

  execute 'drop policy if exists "Users can create actor notifications" on public.notifications';
  execute 'drop policy if exists "Users can create own notifications" on public.notifications';
  execute 'create policy "Users can create own notifications" on public.notifications for insert to authenticated with check (auth.uid() = user_id and (actor_id is null or actor_id = auth.uid()))';

  execute 'drop policy if exists "Admins can create notifications" on public.notifications';
  execute 'create policy "Admins can create notifications" on public.notifications for insert to authenticated with check (public.is_current_user_admin())';
end;
$$;
