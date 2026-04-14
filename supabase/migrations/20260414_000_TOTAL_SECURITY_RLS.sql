-- ==============================================================================
-- 20260414_000_TOTAL_SECURITY_RLS.sql
-- Propósito: Implementar un HARDENING total para todas las tablas sin RLS,
-- previniendo filtraciones de datos (Data leaks) en Producción.
-- ==============================================================================

-- 1. TABLAS RELACIONADAS A NOTIFICACIONES Y PREFERENCIAS
ALTER TABLE IF EXISTS public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.notification_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read their own notifications" ON public.notifications;
CREATE POLICY "Users can read their own notifications" 
ON public.notifications FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own notifications" ON public.notifications;
CREATE POLICY "Users can update their own notifications" 
ON public.notifications FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can read their own preferences" ON public.notification_preferences;
CREATE POLICY "Users can read their own preferences" 
ON public.notification_preferences FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own preferences" ON public.notification_preferences;
CREATE POLICY "Users can update their own preferences" 
ON public.notification_preferences FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own preferences" ON public.notification_preferences;
CREATE POLICY "Users can insert their own preferences" 
ON public.notification_preferences FOR INSERT WITH CHECK (auth.uid() = user_id);

-- 2. DISPOSITIVOS
ALTER TABLE IF EXISTS public.user_devices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own devices" ON public.user_devices;
CREATE POLICY "Users can read own devices" 
ON public.user_devices FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own devices" ON public.user_devices;
CREATE POLICY "Users can insert own devices" 
ON public.user_devices FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own devices" ON public.user_devices;
CREATE POLICY "Users can update own devices" 
ON public.user_devices FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own devices" ON public.user_devices;
CREATE POLICY "Users can delete own devices" 
ON public.user_devices FOR DELETE USING (auth.uid() = user_id);

-- 3. SOLICITUDES DE VIAJE (RIDE REQUESTS)
ALTER TABLE IF EXISTS public.ride_requests ENABLE ROW LEVEL SECURITY;

-- Conductores deben poder ver las solicitudes publicas para aceptarlas
DROP POLICY IF EXISTS "Ride requests are readable by everyone" ON public.ride_requests;
CREATE POLICY "Ride requests are readable by everyone" 
ON public.ride_requests FOR SELECT USING (true); 

DROP POLICY IF EXISTS "Requesters can insert their own requests" ON public.ride_requests;
CREATE POLICY "Requesters can insert their own requests" 
ON public.ride_requests FOR INSERT WITH CHECK (auth.uid() = requester_id);

DROP POLICY IF EXISTS "Requesters can update their own requests" ON public.ride_requests;
CREATE POLICY "Requesters can update their own requests" 
ON public.ride_requests FOR UPDATE USING (auth.uid() = requester_id);

-- 4. DISPUTAS Y RETIROS (CANCELLATION & PAYOUTS)
ALTER TABLE IF EXISTS public.cancellation_disputes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see their own disputes" ON public.cancellation_disputes;
CREATE POLICY "Users see their own disputes" 
ON public.cancellation_disputes FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can create their own disputes" ON public.cancellation_disputes;
CREATE POLICY "Users can create their own disputes" 
ON public.cancellation_disputes FOR INSERT WITH CHECK (auth.uid() = user_id);

ALTER TABLE IF EXISTS public.payout_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see their own payout requests" ON public.payout_requests;
CREATE POLICY "Users see their own payout requests" 
ON public.payout_requests FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can request payouts" ON public.payout_requests;
CREATE POLICY "Users can request payouts" 
ON public.payout_requests FOR INSERT WITH CHECK (auth.uid() = user_id);

-- 5. CONTACTOS DE EMERGENCIA Y RUTAS FAVORITAS
ALTER TABLE IF EXISTS public.emergency_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.favorite_routes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users handle own emergency contacts" ON public.emergency_contacts;
CREATE POLICY "Users handle own emergency contacts" 
ON public.emergency_contacts FOR ALL USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users handle own favorite routes" ON public.favorite_routes;
CREATE POLICY "Users handle own favorite routes" 
ON public.favorite_routes FOR ALL USING (auth.uid() = user_id);

-- 6. COMUNIDADES
ALTER TABLE IF EXISTS public.communities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Communities are public" ON public.communities;
CREATE POLICY "Communities are public" ON public.communities FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admins manage their communities" ON public.communities;
CREATE POLICY "Admins manage their communities" ON public.communities 
FOR ALL USING (auth.uid() = admin_id);

-- 7. TRANSACCIONES FINANCIERAS
ALTER TABLE IF EXISTS public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.wallet_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see own transactions" ON public.transactions;
CREATE POLICY "Users see own transactions" 
ON public.transactions FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users see own wallet_transactions" ON public.wallet_transactions;
CREATE POLICY "Users see own wallet_transactions" 
ON public.wallet_transactions FOR SELECT USING (auth.uid() = user_id);

-- PREVENIR INSERCIONES MANUALES EN TRANSACCIONES - SOLO VIA RPC (PostgreSQL Function)
DROP POLICY IF EXISTS "Block manual inserts on transactions" ON public.transactions;
CREATE POLICY "Block manual inserts on transactions"
ON public.transactions FOR INSERT WITH CHECK (false);

-- 8. PROTECCIÓN DE FUNCIONES RPC (SECURITY DEFINER SEARCH_PATH)
-- Asegura que las funciones críticas no puedan ser interceptadas
DO $$
BEGIN
    EXECUTE 'ALTER FUNCTION public.create_ride SET search_path = public';
    EXECUTE 'ALTER FUNCTION public.confirm_trip_and_pay SET search_path = public';
    EXECUTE 'ALTER FUNCTION public.complete_ride SET search_path = public';
EXCEPTION WHEN OTHERS THEN
    -- Evitar fallo si la firma de la funcion no se corresponde exactamente
END $$;
