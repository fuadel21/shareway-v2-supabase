-- ==========================================
-- 20260506_HARDEN_START_RIDE_TIME.sql
-- Restricción de inicio de viaje (15 min antes)
-- ==========================================

-- 1. Actualizar start_ride con validación de tiempo
CREATE OR REPLACE FUNCTION public.start_ride(p_ride_id UUID)
RETURNS JSONB AS $$
DECLARE
    v_departure_time TIMESTAMPTZ;
    v_driver_id UUID;
    v_status TEXT;
BEGIN
    -- Obtener datos del viaje
    SELECT departure_time, driver_id, status
    INTO v_departure_time, v_driver_id, v_status
    FROM public.rides
    WHERE id = p_ride_id;

    -- Validaciones básicas
    IF v_driver_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'VIAJE_NO_ENCONTRADO');
    END IF;

    IF v_driver_id != auth.uid() THEN
        RETURN jsonb_build_object('success', false, 'error', 'NO_AUTORIZADO');
    END IF;

    IF v_status != 'scheduled' THEN
        RETURN jsonb_build_object('success', false, 'error', 'EL_VIAJE_YA_INICIO_O_TERMINO', 'status', v_status);
    END IF;

    -- RESTRICCIÓN DE AUDITORÍA: Solo 15 minutos antes de la salida
    IF v_departure_time > (NOW() + INTERVAL '15 minutes') THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'DEMASIADO_PRONTO',
            'message', 'Solo puedes iniciar el viaje 15 minutos antes de la hora de salida configurada.',
            'departure_time', v_departure_time
        );
    END IF;

    -- Proceder con el inicio
    UPDATE public.rides
    SET status = 'active',
        started_at = NOW(),
        updated_at = NOW()
    WHERE id = p_ride_id;

    RETURN jsonb_build_object('success', true, 'message', 'Viaje iniciado correctamente');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Actualizar verify_passenger_boarding para respetar la misma restricción
CREATE OR REPLACE FUNCTION public.verify_passenger_boarding(
    p_ride_id UUID,
    p_pin TEXT,
    p_passenger_id UUID DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_updated BOOLEAN;
    v_departure_time TIMESTAMPTZ;
BEGIN
    -- Verificar tiempo antes de permitir boarding si el viaje aún no ha iniciado
    SELECT departure_time INTO v_departure_time
    FROM public.rides
    WHERE id = p_ride_id;

    IF v_departure_time > (NOW() + INTERVAL '15 minutes') THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'DEMASIADO_PRONTO',
            'message', 'No puedes verificar pasajeros hasta 15 minutos antes de la salida.'
        );
    END IF;

    -- Intentar actualizar el estado del pasajero en el array JSONB
    UPDATE public.rides r
    SET
        passengers = (
            SELECT jsonb_agg(
                CASE
                    WHEN (elem->>'pin' = p_pin)
                         AND (p_passenger_id IS NULL OR (elem->>'id')::UUID = p_passenger_id)
                    THEN elem || jsonb_build_object('status', 'verified', 'verified_at', NOW())
                    ELSE elem
                END
            )
            FROM jsonb_array_elements(COALESCE(r.passengers, '[]'::jsonb)) AS elem
        )
    WHERE r.id = p_ride_id
      AND r.driver_id = auth.uid()
      AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(COALESCE(r.passengers, '[]'::jsonb)) AS check_elem
          WHERE check_elem->>'pin' = p_pin
            AND (p_passenger_id IS NULL OR (check_elem->>'id')::UUID = p_passenger_id)
      );

    v_updated := FOUND;

    IF v_updated THEN
        -- Si al menos un pasajero fue verificado, marcamos el viaje como activo (si estaba programado)
        UPDATE public.rides
        SET status = 'active',
            started_at = COALESCE(started_at, NOW()),
            updated_at = NOW()
        WHERE id = p_ride_id AND status = 'scheduled';

        RETURN jsonb_build_object('success', true, 'message', 'Embarque confirmado correctamente');
    ELSE
        RETURN jsonb_build_object('success', false, 'message', 'PIN incorrecto o pasajero no encontrado');
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
