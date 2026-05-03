-- ==============================================================================
-- 20260510_RIDE_INTEGRITY_CONSTRAINTS.sql
-- Nivel Máximo de Seguridad: Validaciones de Integridad de Tiempo en Tabla.
-- ==============================================================================

-- 1. Función de validación de tiempo para el Trigger
CREATE OR REPLACE FUNCTION public.enforce_ride_time_integrity()
RETURNS TRIGGER AS $$
BEGIN
    -- Solo validamos en la CREACIÓN (INSERT)
    -- Permitimos un margen de 10 minutos para evitar errores por lags de red
    IF (TG_OP = 'INSERT') THEN
        IF NEW.departure_time < (NOW() - INTERVAL '10 minutes') THEN
            RAISE EXCEPTION 'No se puede crear un viaje en el pasado. (Departure: %, Now: %)', NEW.departure_time, NOW();
        END IF;
    END IF;

    -- En UPDATEs, podrías querer evitar que alguien mueva un viaje activo al pasado
    -- pero usualmente la lógica de negocio en los RPCs es suficiente.

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Trigger de Integridad de Tiempo
DROP TRIGGER IF EXISTS tr_ride_time_integrity ON public.rides;
CREATE TRIGGER tr_ride_time_integrity
BEFORE INSERT ON public.rides
FOR EACH ROW EXECUTE FUNCTION public.enforce_ride_time_integrity();

-- 3. Nota Informativa:
-- La validación para CONFIRMAR (confirm_trip_and_pay) ya está implementada
-- en el RPC correspondiente para verificar que el viaje no haya salido aún.
