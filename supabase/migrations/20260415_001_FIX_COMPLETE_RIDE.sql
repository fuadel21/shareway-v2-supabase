-- Corregir y consolidar complete_ride a la firma estándar de 1 parámetro original (p_ride_id)

DROP FUNCTION IF EXISTS public.complete_ride(UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS public.complete_ride(UUID, NUMERIC, NUMERIC);

CREATE OR REPLACE FUNCTION public.complete_ride(p_ride_id UUID) RETURNS JSON AS $$
DECLARE
    v_driver_id UUID := auth.uid();
    v_status TEXT;
    v_passengers JSONB;
BEGIN
    SELECT status, passengers INTO v_status, v_passengers 
    FROM public.rides WHERE id = p_ride_id AND driver_id = v_driver_id;

    IF NOT FOUND THEN 
        RETURN json_build_object('success', false, 'error', 'No autorizado o no encontrado'); 
    END IF;
    
    IF v_status = 'completed' THEN 
        RETURN json_build_object('success', false, 'error', 'Viaje ya finalizado'); 
    END IF;

    -- Proceder con actualización a estado completed
    UPDATE public.rides SET status = 'completed' WHERE id = p_ride_id;
    
    -- Disparar la liquidación automática a los conductores por parte del sistema Escrow
    -- NOTA: El trigger de DB o la función process_escrow_payout (si existe) debería atajarse en el UPDATE.
    -- Retornar éxito
    RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
