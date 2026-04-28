-- ==============================================================================
-- 20260501_AUTO_COMPLETE_FUNDS.sql
-- Propósito: Automatizar la liberación de fondos de garantía (escrow)
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.cron_auto_complete_rides()
RETURNS JSON AS $$
DECLARE
    v_ride RECORD;
    v_count INTEGER := 0;
    v_result JSON;
BEGIN
    -- 1. Buscar viajes que empezaron hace más de 12 horas y siguen 'scheduled' o 'in_progress'
    -- (Ajustamos a 12h para ser generosos con el tiempo del trayecto)
    FOR v_ride IN
        SELECT id
        FROM public.rides
        WHERE status IN ('scheduled', 'in_progress')
          AND departure_time < (NOW() - INTERVAL '12 hours')
    LOOP
        -- 2. Llamar a la función oficial de completar para cada uno
        -- Esto ejecutará toda la lógica financiera (balance -> payout)
        SELECT public.complete_ride(v_ride.id) INTO v_result;
        v_count := v_count + 1;
    END LOOP;

    RETURN json_build_object(
        'success', true,
        'rides_completed', v_count,
        'message', 'Limpieza de garantía ejecutada correctamente'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Ejecución inmediata para limpiar los datos actuales de las capturas
SELECT public.cron_auto_complete_rides();
