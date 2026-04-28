-- ==========================================
-- 20260505_RESTORE_VERIFY_BOARDING.sql
-- Restauración de Lógica de Embarque (PIN)
-- ==========================================

-- 1. Eliminar versiones conflictivas para evitar errores de firma
DROP FUNCTION IF EXISTS public.verify_passenger_boarding(uuid, text);
DROP FUNCTION IF EXISTS public.verify_passenger_boarding(uuid, text, uuid);

-- 2. Crear versión definitiva compatible con el frontend "Elite"
CREATE OR REPLACE FUNCTION public.verify_passenger_boarding(
    p_ride_id UUID,
    p_pin TEXT,
    p_passenger_id UUID DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_updated BOOLEAN;
BEGIN
    -- Intentar actualizar el estado del pasajero en el array JSONB usando funciones seguras
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
        -- Si al menos un pasajero fue verificado, marcamos el viaje como activo
        UPDATE public.rides
        SET status = 'active'
        WHERE id = p_ride_id AND status = 'scheduled';

        RETURN jsonb_build_object('success', true, 'message', 'Embarque confirmado correctamente');
    ELSE
        RETURN jsonb_build_object('success', false, 'message', 'PIN incorrecto o pasajero no encontrado');
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
