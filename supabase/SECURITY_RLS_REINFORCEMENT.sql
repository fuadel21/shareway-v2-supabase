-- SHAREWAY V2: ROW LEVEL SECURITY (RLS) REINFORCEMENT
-- Objetivo: Blindar la base de datos contra accesos no autorizados via API.
-- 1. Habilitar RLS en todas las tablas críticas
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ride_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.emergency_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payout_requests ENABLE ROW LEVEL SECURITY;
-- 2. POLÍTICAS: PROFILES
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON public.profiles;
CREATE POLICY "Public profiles are viewable by everyone" ON public.profiles FOR
SELECT USING (true);
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" ON public.profiles FOR
UPDATE USING (auth.uid() = id);
-- 3. POLÍTICAS: WALLETS (Solo lectura)
DROP POLICY IF EXISTS "Users can view own wallet" ON public.wallets;
CREATE POLICY "Users can view own wallet" ON public.wallets FOR
SELECT USING (auth.uid() = user_id);
-- 4. POLÍTICAS: TRANSACTIONS (Solo lectura)
DROP POLICY IF EXISTS "Users can view own transactions" ON public.transactions;
CREATE POLICY "Users can view own transactions" ON public.transactions FOR
SELECT USING (auth.uid() = user_id);
-- 5. POLÍTICAS: RIDES (Lectura pública, No escritura manual)
DROP POLICY IF EXISTS "Rides are viewable by everyone" ON public.rides;
CREATE POLICY "Rides are viewable by everyone" ON public.rides FOR
SELECT USING (true);
DROP POLICY IF EXISTS "Drivers can update own rides" ON public.rides;
CREATE POLICY "Drivers can update own rides" ON public.rides FOR
UPDATE USING (auth.uid() = driver_id);
-- 6. POLÍTICAS: NOTIFICATIONS
DROP POLICY IF EXISTS "Users can view own notifications" ON public.notifications;
CREATE POLICY "Users can view own notifications" ON public.notifications FOR
SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update own notifications" ON public.notifications;
CREATE POLICY "Users can update own notifications" ON public.notifications FOR
UPDATE USING (auth.uid() = user_id);
-- 7. POLÍTICAS: EMERGENCY CONTACTS
DROP POLICY IF EXISTS "Users can manage own emergency contacts" ON public.emergency_contacts;
CREATE POLICY "Users can manage own emergency contacts" ON public.emergency_contacts FOR ALL USING (auth.uid() = user_id);
-- 8. POLÍTICAS: PAYOUT REQUESTS
DROP POLICY IF EXISTS "Users can view own payout requests" ON public.payout_requests;
CREATE POLICY "Users can view own payout requests" ON public.payout_requests FOR
SELECT USING (auth.uid() = user_id);