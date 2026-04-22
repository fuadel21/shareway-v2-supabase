-- ==============================================================================
-- HARDENED PIN SECURITY: PROTECCIÓN CONTRA FUERZA BRUTA Y FRAUDE
-- ==============================================================================

-- 1. Añadimos tracking de intentos a la estructura de pasajeros si no existe
-- (Lo gestionamos dentro del JSONB de passengers para no alterar el esquema)

-- 2. REFACTOR: verify_passenger_boarding con protección de intentos
CREATE OR REPLACE FUNCTION public.verify_passenger_boarding_v2(
    p_ride_id UUID,
    p_passenger_id UUID,
    p_pin TEXT
) RETURNS JSON AS $$
DECLARE
    v_driver_id UUID := auth.uid();
    v_ride_record RECORD;
    v_passenger_entry JSONB;
    v_correct_pin TEXT;
    v_attempts INTEGER;
    v_is_locked BOOLEAN;
BEGIN
    -- A. Bloqueo de fila para evitar condiciones de carrera
    SELECT * INTO v_ride_record FROM public.rides WHERE id = p_ride_id FOR UPDATE;

    -- B. Validaciones de Autoridad y Estado
    IF v_ride_record.driver_id != v_driver_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'NO_AUTORIZADO');
    END IF;

    IF v_ride_record.status NOT IN ('scheduled', 'active', 'in_progress') THEN
        RETURN jsonb_build_object('success', false, 'error', 'ESTADO_INVALIDO', 'message', 'El viaje no está en fase de abordaje.');
    END IF;

    -- C. Obtener entrada del pasajero
    SELECT p INTO v_passenger_entry
    FROM jsonb_array_elements(v_ride_record.passengers) AS p
    WHERE (p->>'id')::UUID = p_passenger_id;

    IF v_passenger_entry IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'PASAJERO_NO_ENCONTRADO');
    END IF;

    -- D. Verificar Bloqueo por Intentos
    v_attempts := COALESCE((v_passenger_entry->>'pin_attempts')::INTEGER, 0);
    v_is_locked := COALESCE((v_passenger_entry->>'pin_locked')::BOOLEAN, false);

    IF v_is_locked THEN
        RETURN jsonb_build_object('success', false, 'error', 'PIN_BLOQUEADO', 'message', 'Demasiados intentos fallidos. Contacta con soporte.');
    END IF;

    v_correct_pin := v_passenger_entry->>'pin';

    -- E. Lógica de Verificación
    IF v_correct_pin = p_pin THEN
        -- ÉXITO: Limpiar intentos y marcar como verificado
        UPDATE public.rides
        SET passengers = (
            SELECT jsonb_agg(
                CASE
                    WHEN (p->>'id')::UUID = p_passenger_id THEN
                        p || jsonb_build_object('status', 'verified', 'verified_at', NOW(), 'pin_attempts', 0)
                    ELSE p
                END
            )
            FROM jsonb_array_elements(v_ride_record.passengers) p
        )
        WHERE id = p_ride_id;

        RETURN jsonb_build_object('success', true, 'message', 'Verificación exitosa. ¡Buen viaje!');
    ELSE
        -- ERROR: Incrementar intentos
        v_attempts := v_attempts + 1;

        UPDATE public.rides
        SET passengers = (
            SELECT jsonb_agg(
                CASE
                    WHEN (p->>'id')::UUID = p_passenger_id THEN
                        p || jsonb_build_object(
                            'pin_attempts', v_attempts,
                            'pin_locked', (v_attempts >= 3)
                        )
                    ELSE p
                END
            )
            FROM jsonb_array_elements(v_ride_record.passengers) p
        )
        WHERE id = p_ride_id;

        IF v_attempts >= 3 THEN
            -- Notificar al pasajero de intento de intrusión
            INSERT INTO public.notifications (user_id, type, title, body, priority)
            VALUES (p_passenger_id, 'security_alert', '⚠️ PIN Bloqueado', 'Se han detectado 3 intentos fallidos de boarding. Tu PIN ha sido bloqueado por seguridad.', 'high');

            RETURN jsonb_build_object('success', false, 'error', 'PIN_BLOQUEADO', 'attempts', v_attempts);
        END IF;

        RETURN jsonb_build_object('success', false, 'error', 'PIN_INCORRECTO', 'attempts_left', (3 - v_attempts));
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
