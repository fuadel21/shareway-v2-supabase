-- ========================================================
-- MIGRACIÓN: SYSTEM AUDIT BLACK-BOX v1.0
-- Objetivo: Registro histórico de cambios sensibles para seguridad y soporte
-- ========================================================
-- 1. TABLA DE LOGS DE AUDITORÍA
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    table_name TEXT NOT NULL,
    record_id UUID NOT NULL,
    operation TEXT NOT NULL,
    old_data JSONB,
    new_data JSONB,
    changed_by UUID,
    -- ID del usuario que realizó el cambio (auth.uid())
    created_at TIMESTAMPTZ DEFAULT NOW()
);
-- Habilitar RLS: Solo admins pueden leer auditoría
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can view all audit logs" ON public.audit_logs FOR
SELECT USING (
        EXISTS (
            SELECT 1
            FROM public.profiles
            WHERE id = auth.uid()
                AND (
                    role = 'admin'
                    OR is_admin = true
                )
        )
    );
-- 2. FUNCIÓN GENÉRICA DE AUDITORÍA
CREATE OR REPLACE FUNCTION public.audit_trigger_fn() RETURNS TRIGGER AS $$
DECLARE v_old_data JSONB := NULL;
v_new_data JSONB := NULL;
BEGIN IF (TG_OP = 'UPDATE') THEN v_old_data := to_jsonb(OLD);
v_new_data := to_jsonb(NEW);
-- Evitar logs innecesarios si nada ha cambiado en los campos detectados
IF v_old_data = v_new_data THEN RETURN NEW;
END IF;
ELSIF (TG_OP = 'DELETE') THEN v_old_data := to_jsonb(OLD);
ELSIF (TG_OP = 'INSERT') THEN v_new_data := to_jsonb(NEW);
END IF;
INSERT INTO public.audit_logs (
        table_name,
        record_id,
        operation,
        old_data,
        new_data,
        changed_by
    )
VALUES (
        TG_TABLE_NAME,
        COALESCE(
            NEW.id,
            OLD.id,
            (NEW.user_id)::UUID,
            (OLD.user_id)::UUID
        ),
        -- Manejo de tablas con user_id como PK
        TG_OP,
        v_old_data,
        v_new_data,
        auth.uid()
    );
RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 3. APLICACIÓN DE TRIGGERS A TABLAS CRÍTICAS
-- A) WALLETS: Cambios de saldo (Vital para detectar fraude o errores de escrow)
DROP TRIGGER IF EXISTS tr_audit_wallets ON public.wallets;
CREATE TRIGGER tr_audit_wallets
AFTER
UPDATE
    OR
INSERT ON public.wallets FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
-- B) PROFILES: Cambios en roles, verificación o suspensiones (Seguridad de identidad)
DROP TRIGGER IF EXISTS tr_audit_profiles ON public.profiles;
CREATE TRIGGER tr_audit_profiles
AFTER
UPDATE ON public.profiles FOR EACH ROW
    WHEN (
        OLD.role IS DISTINCT
        FROM NEW.role
            OR OLD.is_admin IS DISTINCT
        FROM NEW.is_admin
            OR OLD.is_suspended IS DISTINCT
        FROM NEW.is_suspended
            OR OLD.verification IS DISTINCT
        FROM NEW.verification
    ) EXECUTE FUNCTION public.audit_trigger_fn();
-- C) RIDES: Cambios en precios, estados y pasajeros (Evidencia para disputas)
DROP TRIGGER IF EXISTS tr_audit_rides ON public.rides;
CREATE TRIGGER tr_audit_rides
AFTER
UPDATE ON public.rides FOR EACH ROW
    WHEN (
        OLD.status IS DISTINCT
        FROM NEW.status
            OR OLD.price IS DISTINCT
        FROM NEW.price
            OR OLD.passengers IS DISTINCT
        FROM NEW.passengers
    ) EXECUTE FUNCTION public.audit_trigger_fn();
-- D) PAYOUTS: Seguimiento de transferencias de dinero
DROP TRIGGER IF EXISTS tr_audit_payouts ON public.payout_requests;
CREATE TRIGGER tr_audit_payouts
AFTER
UPDATE
    OR
INSERT ON public.payout_requests FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
-- E) RIDE_REQUESTS: Cambios en solicitudes de viaje
DROP TRIGGER IF EXISTS tr_audit_ride_requests ON public.ride_requests;
CREATE TRIGGER tr_audit_ride_requests
AFTER
UPDATE
    OR
INSERT ON public.ride_requests FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();