-- ShareWay production hardening: RLS for rides and money tables
-- Date: 2026-07-07
-- Scope: rides, ride_requests, wallets, wallet_transactions, payout_requests, platform_settings
--
-- Preconditions verified in production audit:
-- - create_ride, update_ride_v2, start_ride, complete_ride, cancel_ride are SECURITY DEFINER
-- - create_ride_request, cancel_ride_request are SECURITY DEFINER
-- - confirm_trip_and_pay, cancel_booking_and_refund, add_funds, request_payout, process_payout are SECURITY DEFINER
-- - admin_update_user_status and update_platform_setting are SECURITY DEFINER

begin;

-- =========================================================
-- Helper admin unificado
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
-- RIDES: cerrar escrituras directas y limpiar SELECT publicos
-- =========================================================
drop policy if exists "Admins bypass rides" on public.rides;
drop policy if exists "Drivers can manage own rides" on public.rides;
drop policy if exists "Enable read access for authenticated users" on public.rides;
drop policy if exists "Public Rides" on public.rides;
drop policy if exists "Visible Rides" on public.rides;
drop policy if exists "rides_insert" on public.rides;
drop policy if exists "rides_select" on public.rides;
drop policy if exists "rides_update" on public.rides;
drop policy if exists "rides_select_visible_or_owner_admin" on public.rides;
drop policy if exists "rides_no_direct_insert" on public.rides;
drop policy if exists "rides_no_direct_update" on public.rides;
drop policy if exists "rides_no_direct_delete" on public.rides;

alter table public.rides enable row level security;
alter table public.rides force row level security;

create policy "rides_select_visible_or_owner_admin"
on public.rides
for select
to authenticated
using (
  public.is_current_user_admin()
  or driver_id = auth.uid()
  or status in ('scheduled', 'active', 'in_progress')
);

-- Sin INSERT/UPDATE/DELETE directos desde cliente.
-- Crear, editar, iniciar, completar y cancelar viaje debe ir por RPC SECURITY DEFINER.

-- =========================================================
-- RIDE_REQUESTS: cerrar escrituras directas
-- =========================================================
drop policy if exists "Admins bypass requests" on public.ride_requests;
drop policy if exists "Secure ride requests access" on public.ride_requests;
drop policy if exists "Users can view their own requests" on public.ride_requests;
drop policy if exists "ride_requests_insert" on public.ride_requests;
drop policy if exists "ride_requests_involved" on public.ride_requests;
drop policy if exists "ride_requests_update" on public.ride_requests;
drop policy if exists "ride_requests_select_involved_or_admin" on public.ride_requests;

alter table public.ride_requests enable row level security;
alter table public.ride_requests force row level security;

create policy "ride_requests_select_involved_or_admin"
on public.ride_requests
for select
to authenticated
using (
  public.is_current_user_admin()
  or requester_id = auth.uid()
  or exists (
    select 1
    from public.rides r
    where r.id = ride_requests.ride_id
      and r.driver_id = auth.uid()
  )
);

-- Sin INSERT/UPDATE/DELETE directos desde cliente.
-- create_ride_request y cancel_ride_request deben ir por RPC.

-- =========================================================
-- WALLETS: solo lectura propia/admin, sin update directo
-- =========================================================
drop policy if exists "Admin full access wallets" on public.wallets;
drop policy if exists "Owner Wallet" on public.wallets;
drop policy if exists "Service role full access" on public.wallets;
drop policy if exists "Users can see own wallet" on public.wallets;
drop policy if exists "Users can update own wallet" on public.wallets;
drop policy if exists "Users can view own wallet" on public.wallets;
drop policy if exists "Users can view their own wallet" on public.wallets;
drop policy if exists "Wallet View Only" on public.wallets;
drop policy if exists "wallets_owner" on public.wallets;
drop policy if exists "wallets_select_own" on public.wallets;
drop policy if exists "wallets_select_own_or_admin" on public.wallets;
drop policy if exists "wallets_service_role_all" on public.wallets;

alter table public.wallets enable row level security;
alter table public.wallets force row level security;

create policy "wallets_select_own_or_admin"
on public.wallets
for select
to authenticated
using (
  user_id = auth.uid()
  or public.is_current_user_admin()
);

create policy "wallets_service_role_all"
on public.wallets
for all
to service_role
using (true)
with check (true);

-- Sin UPDATE directo del saldo desde cliente.
-- add_funds, confirm_trip_and_pay, cancel_booking_and_refund, request_payout y process_payout deben tocar wallet por RPC/servidor.

-- =========================================================
-- WALLET_TRANSACTIONS: solo lectura propia/admin
-- =========================================================
drop policy if exists "Admins can view all transactions" on public.wallet_transactions;
drop policy if exists "Users can view own transactions" on public.wallet_transactions;
drop policy if exists "Users can view their own transactions" on public.wallet_transactions;
drop policy if exists "wallet_transactions_select_own_or_admin" on public.wallet_transactions;
drop policy if exists "wallet_transactions_service_role_all" on public.wallet_transactions;

alter table public.wallet_transactions enable row level security;
alter table public.wallet_transactions force row level security;

create policy "wallet_transactions_select_own_or_admin"
on public.wallet_transactions
for select
to authenticated
using (
  user_id = auth.uid()
  or public.is_current_user_admin()
);

create policy "wallet_transactions_service_role_all"
on public.wallet_transactions
for all
to service_role
using (true)
with check (true);

-- Sin INSERT/UPDATE/DELETE directo desde cliente.

-- =========================================================
-- PAYOUT_REQUESTS: solo lectura propia/admin
-- =========================================================
drop policy if exists "payouts_owner" on public.payout_requests;
drop policy if exists "payout_requests_select_own_or_admin" on public.payout_requests;
drop policy if exists "payout_requests_service_role_all" on public.payout_requests;

alter table public.payout_requests enable row level security;
alter table public.payout_requests force row level security;

create policy "payout_requests_select_own_or_admin"
on public.payout_requests
for select
to authenticated
using (
  user_id = auth.uid()
  or public.is_current_user_admin()
);

create policy "payout_requests_service_role_all"
on public.payout_requests
for all
to service_role
using (true)
with check (true);

-- request_payout y process_payout deben ir por RPC.

-- =========================================================
-- PLATFORM_SETTINGS: lectura autenticada, escritura por RPC admin
-- =========================================================
drop policy if exists "platform_settings_select_authenticated" on public.platform_settings;
drop policy if exists "platform_settings_service_role_all" on public.platform_settings;

alter table public.platform_settings enable row level security;
alter table public.platform_settings force row level security;

create policy "platform_settings_select_authenticated"
on public.platform_settings
for select
to authenticated
using (true);

create policy "platform_settings_service_role_all"
on public.platform_settings
for all
to service_role
using (true)
with check (true);

-- update_platform_setting debe ir por RPC admin.

commit;
