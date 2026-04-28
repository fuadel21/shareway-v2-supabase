-- ==========================================
-- 20260506_LIVE_RADAR_TRIGGERS.sql
-- Registra eventos de usuario en la auditoría para el Live Radar (v2)
-- ==========================================

-- 1. Trigger para NUEVOS VIAJES
CREATE OR REPLACE FUNCTION public.fn_audit_new_ride()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.platform_audit_logs (admin_name, action, target_key, new_value)
    VALUES ('Sistema', 'NEW_RIDE', NEW.id::text, jsonb_build_object('origin', NEW.origin->>'address', 'dest', NEW.destination->>'address', 'price', NEW.price));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS tr_audit_new_ride ON public.rides;
CREATE TRIGGER tr_audit_new_ride AFTER INSERT ON public.rides FOR EACH ROW EXECUTE FUNCTION public.fn_audit_new_ride();

-- 2. Trigger para NUEVAS RESERVAS (Detecta cambios en la columna passengers)
CREATE OR REPLACE FUNCTION public.fn_audit_ride_activity()
RETURNS TRIGGER AS $$
BEGIN
    -- Si el número de pasajeros aumentó, es una nueva reserva
    IF (jsonb_array_length(NEW.passengers) > jsonb_array_length(OLD.passengers)) THEN
        INSERT INTO public.platform_audit_logs (admin_name, action, target_key, new_value)
        VALUES ('Sistema', 'NEW_BOOKING', NEW.id::text, jsonb_build_object('ride_id', NEW.id, 'total_passengers', jsonb_array_length(NEW.passengers)));
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS tr_audit_ride_activity ON public.rides;
CREATE TRIGGER tr_audit_ride_activity AFTER UPDATE OF passengers ON public.rides FOR EACH ROW EXECUTE FUNCTION public.fn_audit_ride_activity();

-- 3. Trigger para SOLICITUDES DE PAGO
CREATE OR REPLACE FUNCTION public.fn_audit_payout_request()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.platform_audit_logs (admin_name, action, target_key, new_value)
    VALUES ('Sistema', 'PAYOUT_REQUEST', NEW.id::text, jsonb_build_object('amount', NEW.amount, 'user_id', NEW.user_id));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS tr_audit_payout_request ON public.payout_requests;
CREATE TRIGGER tr_audit_payout_request AFTER INSERT ON public.payout_requests FOR EACH ROW EXECUTE FUNCTION public.fn_audit_payout_request();
