-- ==============================================================================
-- ENHANCED MATCHING & AUTO-REJECT: GESTIÓN DE ÚLTIMA PLAZA Y EXPIRACIÓN
-- ==============================================================================

-- 1. TRIGGER: Auto-rechazo de solicitudes al agotarse plazas
-- Se ejecuta cuando el seats_available de un viaje llega a 0
CREATE OR REPLACE FUNCTION public.handle_ride_full_house()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.seats_available = 0 AND OLD.seats_available > 0 THEN
        -- 1. Notificar y cancelar solicitudes de este viaje que sigan pendientes
        INSERT INTO public.notifications (user_id, type, title, body, data, category)
        SELECT
            user_id,
            'ride_cancelled',
            'Viaje Completo',
            'Lo sentimos, el viaje que solicitaste ya no tiene plazas disponibles.',
            jsonb_build_object('ride_id', NEW.id, 'reason', 'full_house'),
            'ride'
        FROM public.ride_requests
        WHERE ride_id = NEW.id AND status = 'pending';

        -- 2. Actualizar estado en la tabla de solicitudes
        UPDATE public.ride_requests
        SET status = 'cancelled',
            rejection_reason = 'VIAJE_LLENO',
            updated_at = NOW()
        WHERE ride_id = NEW.id AND status = 'pending';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_ride_full ON public.rides;
CREATE TRIGGER on_ride_full
    AFTER UPDATE OF seats_available ON public.rides
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_ride_full_house();

-- 2. FUNCIÓN: Limpiar solicitudes expiradas (Deadman's Switch)
-- Puede llamarse desde un Edge Function o Cron
CREATE OR REPLACE FUNCTION public.cleanup_expired_requests()
RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER;
BEGIN
    -- Cancelar solicitudes de viajes que ya pasaron
    UPDATE public.ride_requests req
    SET status = 'expired', updated_at = NOW()
    FROM public.rides r
    WHERE req.ride_id = r.id
      AND req.status = 'pending'
      AND r.departure_time < NOW();

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. MEJORA: Priorización en Búsqueda (Rating + Proximidad)
-- Redefinimos el cálculo del match_score para que sea más "Elite"
CREATE OR REPLACE FUNCTION public.calculate_match_score(
    p_ride_origin_geog GEOGRAPHY,
    p_ride_dest_geog GEOGRAPHY,
    p_user_origin_geog GEOGRAPHY,
    p_user_dest_geog GEOGRAPHY,
    p_driver_rating DECIMAL
) RETURNS FLOAT AS $$
DECLARE
    v_dist_origin FLOAT;
    v_dist_dest FLOAT;
    v_score FLOAT;
BEGIN
    v_dist_origin := ST_Distance(p_ride_origin_geog, p_user_origin_geog);
    v_dist_dest := ST_Distance(p_ride_dest_geog, p_user_dest_geog);

    -- Score base 100
    -- Restamos 1 punto por cada 200m de desviación total
    v_score := 100.0 - ((v_dist_origin + v_dist_dest) / 200.0);

    -- Bonus por rating del conductor (hasta 10 puntos extra)
    v_score := v_score + (COALESCE(p_driver_rating, 5.0) * 2.0);

    RETURN LEAST(GREATEST(v_score, 0), 100); -- Clamp entre 0 y 100
END;
$$ LANGUAGE plpgsql IMMUTABLE;
