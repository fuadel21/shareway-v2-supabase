-- ShareWay production hardening: RLS for user-owned tables
-- Date: 2026-07-07
-- Scope: profiles, messages, notifications
--
-- This migration focuses on tables that are allowed to receive direct client writes
-- only when Row Level Security prevents access to other users' data.
--
-- Review column names in your live Supabase schema before applying if your schema differs.

begin;

-- -----------------------------------------------------------------------------
-- Helper: admin check
-- -----------------------------------------------------------------------------
create or replace function public.is_current_user_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (
        coalesce(p.is_admin, false) = true
        or p.role in ('admin', 'super_admin')
      )
  );
$$;

grant execute on function public.is_current_user_admin() to authenticated;

-- -----------------------------------------------------------------------------
-- profiles
-- Expected columns: id uuid primary key, is_admin boolean, role text
-- -----------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.profiles force row level security;

drop policy if exists "profiles_select_self_or_admin" on public.profiles;
drop policy if exists "profiles_insert_self" on public.profiles;
drop policy if exists "profiles_update_self_limited" on public.profiles;
drop policy if exists "profiles_update_admin" on public.profiles;
drop policy if exists "profiles_no_delete_from_client" on public.profiles;

create policy "profiles_select_self_or_admin"
on public.profiles
for select
to authenticated
using (
  id = auth.uid()
  or public.is_current_user_admin()
);

create policy "profiles_insert_self"
on public.profiles
for insert
to authenticated
with check (
  id = auth.uid()
  and coalesce(is_admin, false) = false
  and coalesce(role, 'user') not in ('admin', 'super_admin')
);

-- Users may update their own profile row, but they must not be able to promote
-- themselves. This check keeps admin fields unchanged/non-admin from client.
create policy "profiles_update_self_limited"
on public.profiles
for update
to authenticated
using (id = auth.uid())
with check (
  id = auth.uid()
  and coalesce(is_admin, false) = false
  and coalesce(role, 'user') not in ('admin', 'super_admin')
);

create policy "profiles_update_admin"
on public.profiles
for update
to authenticated
using (public.is_current_user_admin())
with check (public.is_current_user_admin());

-- No client-side deletes for profiles. Account deletion should be handled server-side.
create policy "profiles_no_delete_from_client"
on public.profiles
for delete
to authenticated
using (false);

-- -----------------------------------------------------------------------------
-- messages
-- Expected columns: sender_id uuid, receiver_id uuid, conversation_id uuid/text
-- -----------------------------------------------------------------------------
alter table public.messages enable row level security;
alter table public.messages force row level security;

drop policy if exists "messages_select_participants_or_admin" on public.messages;
drop policy if exists "messages_insert_sender_only" on public.messages;
drop policy if exists "messages_update_sender_or_receiver_limited" on public.messages;
drop policy if exists "messages_no_delete_from_client" on public.messages;

create policy "messages_select_participants_or_admin"
on public.messages
for select
to authenticated
using (
  sender_id = auth.uid()
  or receiver_id = auth.uid()
  or public.is_current_user_admin()
);

create policy "messages_insert_sender_only"
on public.messages
for insert
to authenticated
with check (
  sender_id = auth.uid()
);

-- Allows participants to update metadata such as read_at/is_read only if the row
-- remains attached to the same authenticated sender/receiver side.
-- Stronger field-level restrictions should be enforced with RPC or triggers if needed.
create policy "messages_update_sender_or_receiver_limited"
on public.messages
for update
to authenticated
using (
  sender_id = auth.uid()
  or receiver_id = auth.uid()
)
with check (
  sender_id = auth.uid()
  or receiver_id = auth.uid()
);

-- No client-side hard deletes for messages.
create policy "messages_no_delete_from_client"
on public.messages
for delete
to authenticated
using (false);

-- -----------------------------------------------------------------------------
-- notifications
-- Expected columns: user_id uuid
-- -----------------------------------------------------------------------------
alter table public.notifications enable row level security;
alter table public.notifications force row level security;

drop policy if exists "notifications_select_own_or_admin" on public.notifications;
drop policy if exists "notifications_insert_own_or_admin" on public.notifications;
drop policy if exists "notifications_update_own_or_admin" on public.notifications;
drop policy if exists "notifications_delete_own_or_admin" on public.notifications;

create policy "notifications_select_own_or_admin"
on public.notifications
for select
to authenticated
using (
  user_id = auth.uid()
  or public.is_current_user_admin()
);

-- This allows client-created self notifications while preventing spoofing another user.
-- Server-generated notifications can still be created by service role.
create policy "notifications_insert_own_or_admin"
on public.notifications
for insert
to authenticated
with check (
  user_id = auth.uid()
  or public.is_current_user_admin()
);

create policy "notifications_update_own_or_admin"
on public.notifications
for update
to authenticated
using (
  user_id = auth.uid()
  or public.is_current_user_admin()
)
with check (
  user_id = auth.uid()
  or public.is_current_user_admin()
);

create policy "notifications_delete_own_or_admin"
on public.notifications
for delete
to authenticated
using (
  user_id = auth.uid()
  or public.is_current_user_admin()
);

commit;
