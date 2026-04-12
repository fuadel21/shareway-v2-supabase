-- ==========================================
-- SHAREWAY V2: MASTER DEPLOYMENT SCRIPT
-- ==========================================
-- Este script ejecuta TODOS los componentes del sistema financiero
-- en el orden correcto para garantizar integridad.
-- 
-- ADVERTENCIA: Solo ejecutar en base de datos limpia o después de backup
-- ==========================================
\ echo '🚀 INICIANDO DESPLIEGUE DEL SISTEMA FINANCIERO UNIFICADO' \ echo '==========================================================' -- ==========================================
-- FASE 1: FUNDAMENTOS
-- ==========================================
\ echo '' \ echo '📦 FASE 1: Verificando estructura de wallets y transacciones...' -- Asegurar que existe la tabla wallets
CREATE TABLE IF NOT EXISTS public.wallets (
    user_id UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
    balance NUMERIC(10, 2) DEFAULT 0.00,
    held_balance NUMERIC(10, 2) DEFAULT 0.00,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
-- Asegurar que existe wallet_transactions como tabla principal
CREATE TABLE IF NOT EXISTS public.wallet_transactions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
    wallet_id UUID REFERENCES public.wallets(user_id) ON DELETE CASCADE,
    amount NUMERIC(10, 2) NOT NULL,
    balance_after NUMERIC(10, 2),
    type TEXT,
    description TEXT,
    related_ride_id UUID,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
-- Crear vista de compatibilidad si no existe
CREATE OR REPLACE VIEW public.transactions AS
SELECT *
FROM public.wallet_transactions;
-- Crear wallet de tesorería si no existe
INSERT INTO public.wallets (user_id, balance, held_balance)
VALUES ('00000000-0000-0000-0000-000000000000', 0, 0) ON CONFLICT (user_id) DO NOTHING;
\ echo '✅ Estructura base verificada' -- ==========================================
-- FASE 2: MOTOR FINANCIERO CORE
-- ==========================================
\ echo '' \ echo '💰 FASE 2: Desplegando motor financiero core...' \ i FINAL_UNIFIED_FINANCIAL_ENGINE.sql \ echo '  ✓ Motor unificado de pagos instalado' \ i MASTER_FINANCIAL_HANDLERS.sql \ echo '  ✓ Handlers de pagos externos instalados' \ i STRIPE_CONSOLIDATION_ENGINE.sql \ echo '  ✓ Motor de consolidación Stripe instalado' -- ==========================================
-- FASE 3: CANCELACIONES
-- ==========================================
\ echo '' \ echo '🚫 FASE 3: Desplegando sistema de cancelaciones...' \ i FINAL_CANCELLATION_ENGINE.sql \ echo '  ✓ Motor de cancelaciones con penalizaciones instalado' -- ==========================================
-- FASE 4: REEMBOLSOS Y DISPUTAS
-- ==========================================
\ echo '' \ echo '💸 FASE 4: Desplegando sistema de reembolsos...' \ i FINAL_REFUND_ENGINE.sql \ echo '  ✓ Motor de resolución de disputas instalado' \ i MASTER_REFUND_SYSTEM.sql \ echo '  ✓ Sistema unificado de reembolsos instalado' -- Verificar si existe dispute_system.sql, si no, crear tablas necesarias
CREATE TABLE IF NOT EXISTS public.cancellation_disputes (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    ride_id UUID REFERENCES public.rides(id),
    user_id UUID REFERENCES public.profiles(id),
    user_type TEXT CHECK (user_type IN ('driver', 'passenger')),
    reason TEXT NOT NULL,
    evidence_urls TEXT [],
    refund_amount DECIMAL(10, 2),
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    admin_id UUID REFERENCES public.profiles(id),
    admin_notes TEXT,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS public.refund_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    ride_id UUID REFERENCES public.rides(id),
    user_id UUID REFERENCES public.profiles(id),
    amount DECIMAL(10, 2) NOT NULL,
    type TEXT NOT NULL,
    reason TEXT,
    status TEXT DEFAULT 'processed',
    processed_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
\ echo '  ✓ Sistema de disputas verificado' -- ==========================================
-- FASE 5: RETIROS (PAYOUTS)
-- ==========================================
\ echo '' \ echo '🏦 FASE 5: Desplegando sistema de retiros...' \ i MASTER_PAYOUT_ENGINE.sql \ echo '  ✓ Motor de payouts instalado' -- ==========================================
-- VERIFICACIÓN FINAL
-- ==========================================
\ echo '' \ echo '🔍 VERIFICACIÓN FINAL' \ echo '====================' \ echo '' \ echo 'Funciones RPC instaladas:'
SELECT routine_name
FROM information_schema.routines
WHERE routine_schema = 'public'
    AND routine_name IN (
        'confirm_trip_and_pay',
        'complete_ride',
        'cancel_ride',
        'cancel_booking_and_refund',
        'confirm_stripe_booking',
        'fulfill_booking_after_payment',
        'credit_wallet_on_success',
        'admin_force_refund',
        'request_payout',
        'cancel_payout',
        'resolve_ride_dispute'
    )
ORDER BY routine_name;
\ echo '' \ echo 'Tablas financieras:'
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
    AND table_name IN (
        'wallets',
        'wallet_transactions',
        'refund_logs',
        'payout_requests',
        'cancellation_disputes'
    )
ORDER BY table_name;
\ echo '' \ echo 'Balance de Tesorería:'
SELECT user_id,
    balance,
    held_balance,
    updated_at
FROM public.wallets
WHERE user_id = '00000000-0000-0000-0000-000000000000';
\ echo '' \ echo '✅ DESPLIEGUE COMPLETADO EXITOSAMENTE' \ echo '==========================================' \ echo '' \ echo '📋 PRÓXIMOS PASOS:' \ echo '1. Configurar variables de entorno en Supabase Edge Functions' \ echo '2. Configurar webhook de Stripe' \ echo '3. Probar flujos de pago en staging' \ echo '4. Revisar la guía: DEPLOYMENT_GUIDE_FINANCIAL_SYSTEM.md' \ echo ''