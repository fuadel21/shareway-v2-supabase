-- ========================================================
-- MIGRACIÓN DEFINITIVA: OPTIMIZE RLS PERFORMANCE (v5)
-- Objetivo: Blindaje dinámico contra errores de esquema
-- Nivel: Principal Engineer / Zero-Failure Guarantee
-- ========================================================

-- 1. LIMPIEZA TOTAL DE POLÍTICAS EXISTENTES
-- Eliminamos todas las políticas para empezar desde cero y evitar colisiones de "multiple permissive policies"
DO $$ 
DECLARE 
    pol RECORD;
BEGIN 
    FOR pol IN (
        SELECT policyname, tablename 
        FROM pg_policies 
        WHERE schemaname = 'public'
    ) LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, pol.tablename);
    END LOOP;
END $$;

-- 2. RE-CREACIÓN DE POLÍTICAS NÚCLEO (Tablas Estables)

-- [PROFILES]
CREATE POLICY "profiles_select" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "profiles_insert" ON public.profiles FOR INSERT WITH CHECK ((SELECT auth.uid()) = id);
CREATE POLICY "profiles_update" ON public.profiles FOR UPDATE USING ((SELECT auth.uid()) = id);

-- [WALLETS]
CREATE POLICY "wallets_owner" ON public.wallets FOR ALL USING ((SELECT auth.uid()) = user_id);

-- [TRANSACTIONS]
CREATE POLICY "transactions_owner" ON public.transactions FOR SELECT USING ((SELECT auth.uid()) = user_id);

-- [RIDES]
CREATE POLICY "rides_select" ON public.rides FOR SELECT USING (true);
CREATE POLICY "rides_insert" ON public.rides FOR INSERT WITH CHECK ((SELECT auth.uid()) = driver_id);
CREATE POLICY "rides_update" ON public.rides FOR UPDATE USING ((SELECT auth.uid()) = driver_id);

-- 3. POLÍTICAS DINÁMICAS (Verificando existencia de columnas)

DO $$ 
BEGIN 
    -- [RIDE_REQUESTS]
    -- Solo creamos la política de 'involved' si existe ride_id
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ride_requests' AND column_name='ride_id') THEN
        EXECUTE 'CREATE POLICY "ride_requests_involved" ON public.ride_requests FOR SELECT USING (
            (SELECT auth.uid()) = requester_id 
            OR EXISTS (SELECT 1 FROM public.rides WHERE id = ride_id AND driver_id = (SELECT auth.uid()))
        )';
    ELSE
        EXECUTE 'CREATE POLICY "ride_requests_involved" ON public.ride_requests FOR SELECT USING ((SELECT auth.uid()) = requester_id)';
    END IF;
    
    EXECUTE 'CREATE POLICY "ride_requests_insert" ON public.ride_requests FOR INSERT WITH CHECK ((SELECT auth.uid()) = requester_id)';
    EXECUTE 'CREATE POLICY "ride_requests_update" ON public.ride_requests FOR UPDATE USING ((SELECT auth.uid()) = requester_id)';

    -- [PACKAGES]
    -- Verificamos si existe la columna ride_id en packages
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='packages' AND column_name='ride_id') THEN
        EXECUTE 'CREATE POLICY "packages_select" ON public.packages FOR SELECT USING (
            (SELECT auth.uid()) = sender_id 
            OR EXISTS (SELECT 1 FROM public.rides WHERE id = ride_id AND driver_id = (SELECT auth.uid()))
        )';
    ELSE
        EXECUTE 'CREATE POLICY "packages_select" ON public.packages FOR SELECT USING ((SELECT auth.uid()) = sender_id)';
    END IF;
    
    EXECUTE 'CREATE POLICY "packages_insert" ON public.packages FOR INSERT WITH CHECK ((SELECT auth.uid()) = sender_id)';

END $$;

-- [CHATS & MESSAGES]
CREATE POLICY "chats_owner" ON public.chats FOR SELECT USING ((SELECT auth.uid()) = ANY(participants));
CREATE POLICY "messages_select" ON public.messages FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.chats WHERE id = chat_id AND (SELECT auth.uid()) = ANY(participants))
);
CREATE POLICY "messages_insert" ON public.messages FOR INSERT WITH CHECK ((SELECT auth.uid()) = sender_id);

-- [NOTIFICATIONS]
CREATE POLICY "notifications_owner" ON public.notifications FOR ALL USING ((SELECT auth.uid()) = user_id);

-- [DISPUTES]
CREATE POLICY "disputes_involved" ON public.ride_disputes FOR SELECT USING (
    (SELECT auth.uid()) = reporter_id 
    OR (SELECT auth.uid()) = target_id
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = (SELECT auth.uid()) AND is_admin = true)
);

-- [PAYOUT_REQUESTS]
CREATE POLICY "payouts_owner" ON public.payout_requests FOR SELECT USING (
    (SELECT auth.uid()) = user_id 
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = (SELECT auth.uid()) AND is_admin = true)
);

-- [USER_ACHIEVEMENTS]
CREATE POLICY "achievements_owner" ON public.user_achievements FOR SELECT USING ((SELECT auth.uid()) = user_id);

-- 4. RE-HABILITAR RLS (Garantía de Seguridad)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ride_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ride_disputes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payout_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_achievements ENABLE ROW LEVEL SECURITY;
