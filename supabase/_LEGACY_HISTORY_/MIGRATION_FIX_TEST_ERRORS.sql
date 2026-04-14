-- ========================================================
-- MIGRACIÓN: FIX TEST ERRORS v1.0
-- Objetivo: Asegurar que las columnas de comunidad existan y arreglar tipos JSON.
-- ========================================================

-- 1. ASEGURAR COLUMNA EN COMMUNITIES
-- Si la columna no existe, la creamos. Si existe, no hace nada.
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='communities' AND column_name='allowed_domain') THEN
        ALTER TABLE public.communities ADD COLUMN allowed_domain TEXT UNIQUE;
    END IF;
END $$;

-- 2. LIMPIEZA DE NOTIFICACIONES PARA EL TEST 3
-- Arreglamos el trigger de notificaciones para evitar errores de sintaxis JSON
CREATE OR REPLACE FUNCTION public.handle_ride_status_notification()
RETURNS TRIGGER AS $$
DECLARE
    v_passenger_id UUID;
BEGIN
    IF OLD.status IS DISTINCT FROM NEW.status THEN
        FOR v_passenger_id IN SELECT unnest(NEW.participant_ids) LOOP
            IF v_passenger_id != NEW.driver_id THEN
                -- Usamos build_object para asegurar que el payload sea JSON puro
                PERFORM public.create_notification(
                    v_passenger_id,
                    CASE 
                        WHEN NEW.status = 'active' THEN '¡Viaje en marcha! 🚗'
                        WHEN NEW.status = 'completed' THEN 'Has llegado a tu destino 🏁'
                        ELSE 'Actualización de viaje'
                    END,
                    'El estado de tu viaje ha cambiado a ' || NEW.status,
                    'ride_update',
                    jsonb_build_object('ride_id', NEW.id, 'status', NEW.status)
                );
            END IF;
        END LOOP;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. RE-VINCULAR TRIGGER
DROP TRIGGER IF EXISTS tr_on_ride_status_notify ON public.rides;
CREATE TRIGGER tr_on_ride_status_notify
AFTER UPDATE OF status ON public.rides
FOR EACH ROW
EXECUTE FUNCTION public.handle_ride_status_notification();
