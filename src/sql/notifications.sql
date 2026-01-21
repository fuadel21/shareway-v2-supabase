-- Create notifications table
create table public.notifications (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  title text not null,
  content text,
  type text default 'info', -- 'info', 'success', 'warning', 'error', 'booking', 'payment'
  read boolean default false,
  data jsonb default '{}'::jsonb, -- For storing related IDs (ride_id, etc.)
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable RLS
alter table public.notifications enable row level security;

-- Policies
create policy "Users can view their own notifications"
  on public.notifications for select
  using (auth.uid() = user_id);

create policy "Users can update their own notifications"
  on public.notifications for update
  using (auth.uid() = user_id);

-- Function to create notification (callable from other RPCs or triggers)
create or replace function public.create_notification(
  p_user_id uuid,
  p_title text,
  p_content text,
  p_type text default 'info',
  p_data jsonb default '{}'::jsonb
) returns uuid as $$
declare
  v_id uuid;
begin
  insert into public.notifications (user_id, title, content, type, data)
  values (p_user_id, p_title, p_content, p_type, p_data)
  returning id into v_id;
  return v_id;
end;
$$ language plpgsql security definer;
