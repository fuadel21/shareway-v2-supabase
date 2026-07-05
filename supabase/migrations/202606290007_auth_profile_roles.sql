-- ShareWay auth/profile role hardening
-- Ensures every new auth user gets a real profile with passenger/driver role.

alter table public.profiles
  add column if not exists email text,
  add column if not exists display_name text,
  add column if not exists phone text,
  add column if not exists role text default 'passenger',
  add column if not exists is_driver boolean default false,
  add column if not exists is_passenger boolean default true,
  add column if not exists updated_at timestamptz default now();

update public.profiles
set
  role = coalesce(nullif(role, ''), case when coalesce(is_driver, false) then 'driver' else 'passenger' end),
  is_passenger = coalesce(is_passenger, true),
  is_driver = coalesce(is_driver, false),
  updated_at = now()
where role is null
   or role = ''
   or is_passenger is null
   or is_driver is null;

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_display_name text;
  v_phone text;
begin
  v_role := lower(coalesce(
    new.raw_user_meta_data->>'role',
    new.raw_user_meta_data->>'account_type',
    new.raw_user_meta_data->>'user_type',
    'passenger'
  ));

  if v_role in ('conductor', 'driver_user') then
    v_role := 'driver';
  elsif v_role in ('pasajero', 'passenger_user') then
    v_role := 'passenger';
  end if;

  if v_role not in ('passenger', 'driver', 'admin', 'super_admin') then
    v_role := 'passenger';
  end if;

  v_display_name := coalesce(
    nullif(new.raw_user_meta_data->>'display_name', ''),
    nullif(new.raw_user_meta_data->>'full_name', ''),
    split_part(coalesce(new.email, ''), '@', 1),
    'Usuario'
  );

  v_phone := coalesce(new.raw_user_meta_data->>'phone', '');

  insert into public.profiles (
    id,
    email,
    display_name,
    phone,
    role,
    is_driver,
    is_passenger,
    updated_at
  ) values (
    new.id,
    new.email,
    v_display_name,
    v_phone,
    v_role,
    v_role in ('driver', 'admin', 'super_admin'),
    true,
    now()
  )
  on conflict (id) do update set
    email = coalesce(excluded.email, public.profiles.email),
    display_name = coalesce(nullif(public.profiles.display_name, ''), excluded.display_name),
    phone = coalesce(nullif(public.profiles.phone, ''), excluded.phone),
    role = case
      when public.profiles.role in ('admin', 'super_admin') then public.profiles.role
      when excluded.role is not null then excluded.role
      else coalesce(public.profiles.role, 'passenger')
    end,
    is_driver = coalesce(public.profiles.is_driver, false) or excluded.is_driver,
    is_passenger = coalesce(public.profiles.is_passenger, true),
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;

create trigger on_auth_user_created_profile
after insert on auth.users
for each row
execute function public.handle_new_user_profile();

-- Repair profiles for users that already exist in auth.users but do not have profile rows.
insert into public.profiles (
  id,
  email,
  display_name,
  phone,
  role,
  is_driver,
  is_passenger,
  updated_at
)
select
  u.id,
  u.email,
  coalesce(
    nullif(u.raw_user_meta_data->>'display_name', ''),
    nullif(u.raw_user_meta_data->>'full_name', ''),
    split_part(coalesce(u.email, ''), '@', 1),
    'Usuario'
  ) as display_name,
  coalesce(u.raw_user_meta_data->>'phone', '') as phone,
  case
    when lower(coalesce(u.raw_user_meta_data->>'role', u.raw_user_meta_data->>'account_type', u.raw_user_meta_data->>'user_type', 'passenger')) in ('driver', 'conductor', 'driver_user') then 'driver'
    when lower(coalesce(u.raw_user_meta_data->>'role', u.raw_user_meta_data->>'account_type', u.raw_user_meta_data->>'user_type', 'passenger')) in ('admin', 'super_admin') then lower(coalesce(u.raw_user_meta_data->>'role', u.raw_user_meta_data->>'account_type', u.raw_user_meta_data->>'user_type'))
    else 'passenger'
  end as role,
  lower(coalesce(u.raw_user_meta_data->>'role', u.raw_user_meta_data->>'account_type', u.raw_user_meta_data->>'user_type', 'passenger')) in ('driver', 'conductor', 'driver_user', 'admin', 'super_admin') as is_driver,
  true as is_passenger,
  now()
from auth.users u
where not exists (
  select 1 from public.profiles p where p.id = u.id
)
on conflict (id) do nothing;

notify pgrst, 'reload schema';
