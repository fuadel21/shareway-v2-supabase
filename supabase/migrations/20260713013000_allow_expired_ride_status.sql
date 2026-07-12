-- Allow the expiration job to mark old scheduled rides as expired.
-- Previous schema had rides_status_check without the new value.

alter table public.rides
  drop constraint if exists rides_status_check;

alter table public.rides
  add constraint rides_status_check
  check (
    status in (
      'scheduled',
      'active',
      'in_progress',
      'completed',
      'cancelled',
      'canceled',
      'expired',
      'emergency_stopped'
    )
  );
