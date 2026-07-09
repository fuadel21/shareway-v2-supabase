-- ShareWay production hardening: final RLS cleanup for user-owned tables
-- Date: 2026-07-07
-- Scope: profiles, messages, notifications
--
-- This migration removes duplicated legacy PUBLIC policies and keeps a compact
-- authenticated-only RLS model for profile, chat message and notification flows.

begin;

-- =========================================================
-- Helper admin
-- =========================================================
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

-- =========================================================
-- PROFILES: remove legacy policies and recreate strict set
-- =========================================================
drop policy if exists "Users can edit own profile" on public.profiles;
drop policy if exists "Users can insert their own profile" on public.profiles;
drop policy if exists "Users can read their own profile" on public.profiles;
drop policy if exists "Users can update their own profile" on public.profiles;
drop policy if exists "Users own profile and admins all profiles" on public.profiles;
drop policy if exists "profiles_insert" on public.profiles;
drop policy if exists "profiles_insert_self" on public.profiles;
drop policy if exists "profiles_no_delete_from_client" on public.profiles;
drop policy if exists "profiles_select_self_or_admin" on public.profiles;
drop policy if exists "profiles_update" on public.profiles;
drop policy if exists "profiles_update_admin" on public.profiles;
drop policy if exists "profiles_update_self_limited" on public.profiles;

alter table public.profiles enable row level security;
alter table public.profiles force row level security;

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

create policy "profiles_no_delete_from_client"
on public.profiles
for delete
to authenticated
using (false);

-- =========================================================
-- MESSAGES: remove legacy policies and recreate chat-participant model
-- =========================================================
drop policy if exists "Participants can read chat messages" on public.messages;
drop policy if exists "Participants can send messages" on public.messages;
drop policy if exists "Users can insert messages in their chats" on public.messages;
drop policy if exists "Users can send messages to their chats" on public.messages;
drop policy if exists "Users can update messages in their chats" on public.messages;
drop policy if exists "Users can view messages in their chats" on public.messages;
drop policy if exists "Users can view messages of their chats" on public.messages;
drop policy if exists "messages_insert_sender_only" on public.messages;
drop policy if exists "messages_insert_v3" on public.messages;
drop policy if exists "messages_no_delete_from_client" on public.messages;
drop policy if exists "messages_select_participants_or_admin" on public.messages;
drop policy if exists "messages_select_v3" on public.messages;
drop policy if exists "messages_update_sender_or_receiver_limited" on public.messages;
drop policy if exists "messages_update_participants_limited" on public.messages;

alter table public.messages enable row level security;
alter table public.messages force row level security;

create policy "messages_select_participants_or_admin"
on public.messages
for select
to authenticated
using (
  public.is_current_user_admin()
  or exists (
    select 1
    from public.chats c
    where c.id = messages.chat_id
      and auth.uid() = any(c.participants)
  )
);

create policy "messages_insert_sender_only"
on public.messages
for insert
to authenticated
with check (
  sender_id = auth.uid()
  and exists (
    select 1
    from public.chats c
    left join public.rides r on r.id = c.ride_id
    where c.id = messages.chat_id
      and auth.uid() = any(c.participants)
      and (
        c.ride_id is null
        or r.status in ('scheduled', 'active', 'in_progress')
      )
  )
  and not coalesce(public.is_chat_locked(messages.chat_id), false)
);

create policy "messages_update_participants_limited"
on public.messages
for update
to authenticated
using (
  public.is_current_user_admin()
  or exists (
    select 1
    from public.chats c
    where c.id = messages.chat_id
      and auth.uid() = any(c.participants)
  )
)
with check (
  public.is_current_user_admin()
  or exists (
    select 1
    from public.chats c
    where c.id = messages.chat_id
      and auth.uid() = any(c.participants)
  )
);

create policy "messages_no_delete_from_client"
on public.messages
for delete
to authenticated
using (false);

-- =========================================================
-- NOTIFICATIONS: remove legacy policies and recreate owner/admin model
-- =========================================================
drop policy if exists "Own Notifications" on public.notifications;
drop policy if exists "Users can create own notifications" on public.notifications;
drop policy if exists "Users can delete own notifications" on public.notifications;
drop policy if exists "Users can read own notifications" on public.notifications;
drop policy if exists "Users can see own notifications" on public.notifications;
drop policy if exists "Users can see their own notifications" on public.notifications;
drop policy if exists "Users can update own notifications" on public.notifications;
drop policy if exists "Users can update their own notifications" on public.notifications;
drop policy if exists "notifications_delete_own_or_admin" on public.notifications;
drop policy if exists "notifications_insert_own_or_admin" on public.notifications;
drop policy if exists "notifications_select_own_or_admin" on public.notifications;
drop policy if exists "notifications_update_own_or_admin" on public.notifications;

alter table public.notifications enable row level security;
alter table public.notifications force row level security;

create policy "notifications_select_own_or_admin"
on public.notifications
for select
to authenticated
using (
  user_id = auth.uid()
  or public.is_current_user_admin()
);

create policy "notifications_insert_own_or_admin"
on public.notifications
for insert
to authenticated
with check (
  (
    user_id = auth.uid()
    and (actor_id is null or actor_id = auth.uid())
  )
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
  (
    user_id = auth.uid()
    and (actor_id is null or actor_id = auth.uid())
  )
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
