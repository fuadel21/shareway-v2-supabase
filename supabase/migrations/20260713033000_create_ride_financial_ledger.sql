-- Ride financial ledger.
-- Creates a per-ride financial audit trail without changing existing payment flows.
-- Existing wallet transactions are mirrored best-effort only when a ride_id can be detected.

create table if not exists public.ride_financial_ledger (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid references public.rides(id) on delete set null,
  actor_user_id uuid references public.profiles(id) on delete set null,
  wallet_id uuid references public.wallets(id) on delete set null,
  source_transaction_id uuid unique references public.wallet_transactions(id) on delete set null,
  event_type text not null default 'wallet_transaction',
  status text not null default 'recorded',
  currency text not null default 'EUR',
  gross_amount numeric(12,2) not null default 0,
  platform_fee numeric(12,2) not null default 0,
  driver_amount numeric(12,2) not null default 0,
  refund_amount numeric(12,2) not null default 0,
  net_amount numeric(12,2) not null default 0,
  description text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.ride_financial_ledger is 'Per-ride financial audit trail for gross amounts, platform fees, driver amounts, refunds and wallet transaction mirrors.';
comment on column public.ride_financial_ledger.event_type is 'Examples: booking_paid, platform_fee, driver_payout, refund, cancellation, no_show, wallet_transaction.';
comment on column public.ride_financial_ledger.source_transaction_id is 'Wallet transaction mirrored into the ride ledger, when available.';

create index if not exists ride_financial_ledger_ride_id_idx on public.ride_financial_ledger (ride_id);
create index if not exists ride_financial_ledger_actor_user_id_idx on public.ride_financial_ledger (actor_user_id);
create index if not exists ride_financial_ledger_event_type_idx on public.ride_financial_ledger (event_type);
create index if not exists ride_financial_ledger_created_at_idx on public.ride_financial_ledger (created_at desc);
create index if not exists ride_financial_ledger_metadata_gin_idx on public.ride_financial_ledger using gin (metadata);

alter table public.ride_financial_ledger enable row level security;

-- Reads are available to admins and ride participants.
drop policy if exists ride_financial_ledger_select_admin_or_participant on public.ride_financial_ledger;
create policy ride_financial_ledger_select_admin_or_participant
on public.ride_financial_ledger
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and coalesce(p.role, '') = 'admin'
  )
  or exists (
    select 1
    from public.rides r
    where r.id = ride_financial_ledger.ride_id
      and (
        r.driver_id = auth.uid()
        or auth.uid() = any(coalesce(r.participant_ids, array[]::uuid[]))
      )
  )
);

-- Direct client inserts are limited to admins. Automated inserts go through security definer helpers/triggers.
drop policy if exists ride_financial_ledger_insert_admin_only on public.ride_financial_ledger;
create policy ride_financial_ledger_insert_admin_only
on public.ride_financial_ledger
for insert
to authenticated
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and coalesce(p.role, '') = 'admin'
  )
);

drop policy if exists ride_financial_ledger_no_client_update on public.ride_financial_ledger;
create policy ride_financial_ledger_no_client_update
on public.ride_financial_ledger
for update
to authenticated
using (false)
with check (false);

drop policy if exists ride_financial_ledger_no_client_delete on public.ride_financial_ledger;
create policy ride_financial_ledger_no_client_delete
on public.ride_financial_ledger
for delete
to authenticated
using (false);

create or replace function public.touch_ride_financial_ledger_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_touch_ride_financial_ledger_updated_at on public.ride_financial_ledger;
create trigger trg_touch_ride_financial_ledger_updated_at
before update on public.ride_financial_ledger
for each row
execute function public.touch_ride_financial_ledger_updated_at();

create or replace function public.record_ride_financial_event(
  p_ride_id uuid,
  p_actor_user_id uuid default null,
  p_event_type text default 'manual',
  p_status text default 'recorded',
  p_gross_amount numeric default 0,
  p_platform_fee numeric default 0,
  p_driver_amount numeric default 0,
  p_refund_amount numeric default 0,
  p_description text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_source_transaction_id uuid default null,
  p_wallet_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.ride_financial_ledger (
    ride_id,
    actor_user_id,
    wallet_id,
    source_transaction_id,
    event_type,
    status,
    gross_amount,
    platform_fee,
    driver_amount,
    refund_amount,
    net_amount,
    description,
    metadata
  ) values (
    p_ride_id,
    p_actor_user_id,
    p_wallet_id,
    p_source_transaction_id,
    coalesce(nullif(trim(p_event_type), ''), 'manual'),
    coalesce(nullif(trim(p_status), ''), 'recorded'),
    round(coalesce(p_gross_amount, 0)::numeric, 2),
    round(coalesce(p_platform_fee, 0)::numeric, 2),
    round(coalesce(p_driver_amount, 0)::numeric, 2),
    round(coalesce(p_refund_amount, 0)::numeric, 2),
    round((coalesce(p_gross_amount, 0) - coalesce(p_platform_fee, 0) - coalesce(p_refund_amount, 0))::numeric, 2),
    p_description,
    coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (source_transaction_id) do update set
    metadata = public.ride_financial_ledger.metadata || excluded.metadata,
    updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.record_ride_financial_event(uuid, uuid, text, text, numeric, numeric, numeric, numeric, text, jsonb, uuid, uuid)
is 'Security definer helper to append a normalized financial event to the ride ledger.';

revoke all on function public.record_ride_financial_event(uuid, uuid, text, text, numeric, numeric, numeric, numeric, text, jsonb, uuid, uuid) from public;
revoke execute on function public.record_ride_financial_event(uuid, uuid, text, text, numeric, numeric, numeric, numeric, text, jsonb, uuid, uuid) from authenticated;
grant execute on function public.record_ride_financial_event(uuid, uuid, text, text, numeric, numeric, numeric, numeric, text, jsonb, uuid, uuid) to service_role;

create or replace function public.sync_ride_financial_ledger_from_wallet_transaction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tx jsonb := to_jsonb(new);
  v_metadata jsonb := coalesce(v_tx->'metadata', '{}'::jsonb);
  v_ride_id uuid := null;
  v_actor_user_id uuid := null;
  v_wallet_id uuid := null;
  v_amount numeric := 0;
  v_type text := 'wallet_transaction';
  v_description text := null;
  v_platform_fee numeric := 0;
  v_driver_amount numeric := 0;
  v_refund_amount numeric := 0;
begin
  begin
    v_ride_id := coalesce(
      nullif(v_tx->>'ride_id', '')::uuid,
      nullif(v_metadata->>'ride_id', '')::uuid,
      nullif(v_metadata->>'rideId', '')::uuid
    );
  exception when others then
    v_ride_id := null;
  end;

  if v_ride_id is null then
    return new;
  end if;

  begin
    v_actor_user_id := coalesce(
      nullif(v_tx->>'user_id', '')::uuid,
      nullif(v_metadata->>'user_id', '')::uuid,
      nullif(v_metadata->>'userId', '')::uuid,
      nullif(v_metadata->>'passenger_id', '')::uuid,
      nullif(v_metadata->>'driver_id', '')::uuid
    );
  exception when others then
    v_actor_user_id := null;
  end;

  begin
    v_wallet_id := nullif(v_tx->>'wallet_id', '')::uuid;
  exception when others then
    v_wallet_id := null;
  end;

  v_amount := round(coalesce(nullif(v_tx->>'amount', '')::numeric, 0), 2);
  v_type := coalesce(nullif(v_tx->>'type', ''), nullif(v_tx->>'transaction_type', ''), nullif(v_tx->>'category', ''), 'wallet_transaction');
  v_description := coalesce(nullif(v_tx->>'description', ''), nullif(v_tx->>'reason', ''), v_type);

  if lower(v_type) like '%refund%' or lower(v_description) like '%refund%' or lower(v_description) like '%reembolso%' then
    v_refund_amount := abs(v_amount);
  elsif lower(v_type) like '%platform%' or lower(v_type) like '%fee%' or lower(v_type) like '%commission%' or lower(v_description) like '%comisi%' then
    v_platform_fee := abs(v_amount);
  elsif lower(v_type) like '%payout%' or lower(v_description) like '%conductor%' or lower(v_description) like '%driver%' then
    v_driver_amount := abs(v_amount);
  end if;

  perform public.record_ride_financial_event(
    v_ride_id,
    v_actor_user_id,
    coalesce(v_type, 'wallet_transaction'),
    coalesce(nullif(v_tx->>'status', ''), 'recorded'),
    case when v_refund_amount > 0 then 0 else abs(v_amount) end,
    v_platform_fee,
    v_driver_amount,
    v_refund_amount,
    v_description,
    jsonb_build_object('source', 'wallet_transactions', 'raw', v_tx),
    new.id,
    v_wallet_id
  );

  return new;
end;
$$;

comment on function public.sync_ride_financial_ledger_from_wallet_transaction()
is 'Mirrors wallet transactions into ride_financial_ledger when the transaction or metadata contains a ride_id.';

drop trigger if exists trg_sync_ride_financial_ledger_wallet_transactions on public.wallet_transactions;
create trigger trg_sync_ride_financial_ledger_wallet_transactions
after insert on public.wallet_transactions
for each row
execute function public.sync_ride_financial_ledger_from_wallet_transaction();
