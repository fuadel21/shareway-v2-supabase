-- Growth analytics foundation for ShareWay
-- Tracks product, SEO, referral and conversion events safely.

create table if not exists public.growth_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  event_name text not null,
  user_id uuid references auth.users(id) on delete set null,
  session_id text,
  path text,
  referrer text,
  source text,
  medium text,
  campaign text,
  referral_code text,
  entity_type text,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists growth_events_created_at_idx on public.growth_events (created_at desc);
create index if not exists growth_events_event_name_idx on public.growth_events (event_name);
create index if not exists growth_events_user_id_idx on public.growth_events (user_id);
create index if not exists growth_events_referral_code_idx on public.growth_events (referral_code) where referral_code is not null;
create index if not exists growth_events_path_idx on public.growth_events (path) where path is not null;

alter table public.growth_events enable row level security;

-- Authenticated users can insert their own events. Anonymous public tracking is intentionally not enabled here.
drop policy if exists "Users can insert own growth events" on public.growth_events;
create policy "Users can insert own growth events"
on public.growth_events
for insert
to authenticated
with check (auth.uid() = user_id or user_id is null);

-- Admins can read analytics.
drop policy if exists "Admins can read growth events" on public.growth_events;
create policy "Admins can read growth events"
on public.growth_events
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles admin_profile
    where admin_profile.id = auth.uid()
      and (
        admin_profile.is_admin = true
        or admin_profile.role in ('admin', 'super_admin')
      )
  )
);

create or replace view public.growth_daily_summary as
select
  date_trunc('day', created_at)::date as day,
  count(*) filter (where event_name = 'page_view') as page_views,
  count(*) filter (where event_name = 'signup_completed') as signups,
  count(*) filter (where event_name = 'ride_created') as rides_created,
  count(*) filter (where event_name = 'booking_started') as booking_starts,
  count(*) filter (where event_name = 'booking_completed') as bookings_completed,
  count(*) filter (where event_name = 'invite_landing_view') as invite_views,
  count(*) filter (where event_name = 'referral_link_shared') as referral_shares,
  count(distinct user_id) filter (where user_id is not null) as active_users
from public.growth_events
group by 1
order by 1 desc;

create or replace view public.growth_referral_summary as
select
  referral_code,
  count(*) filter (where event_name = 'invite_landing_view') as invite_views,
  count(*) filter (where event_name = 'signup_completed') as signups,
  count(*) filter (where event_name = 'referral_link_shared') as shares,
  max(created_at) as last_activity_at
from public.growth_events
where referral_code is not null
group by referral_code
order by signups desc, invite_views desc;
