-- Enable Supabase Realtime for notifications.
-- Safe if the table was already added to the publication.

do $$
begin
  alter publication supabase_realtime add table public.notifications;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
