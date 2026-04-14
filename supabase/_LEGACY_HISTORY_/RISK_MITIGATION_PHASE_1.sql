-- ==========================================
-- SHAREWAY V2: RISK MITIGATION PHASE 1
-- PREVENCIÓN DE INSOLVENCIA DE CONDUCTORES
-- ==========================================

-- Esta función lanza una barrera de seguridad a nivel base de datos.
-- Si el conductor tiene una deuda con la plataforma (saldo negativo por multas previas),
-- no se le permitirá publicar ningún viaje nuevo bajo su nombre hasta que lo salde.

CREATE OR REPLACE FUNCTION public.prevent_insolvent_driver_publishing() RETURNS TRIGGER AS $$
DECLARE
    v_balance DECIMAL;
BEGIN
    -- Comprobamos el saldo de la cartera asociada a este conductor
    SELECT balance INTO v_balance FROM public.wallets WHERE user_id = NEW.driver_id;
    
    -- Bloqueo tajante
    IF v_balance < 0 THEN
        RAISE EXCEPTION 'ACCESO DENEGADO: Tienes una deuda pendiente con la plataforma de %€. Recarga tu balance en la app para volver a publicar viajes.', v_balance;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Anclamos la barrera de seguridad a la tabla de viajes
DROP TRIGGER IF EXISTS trigger_prevent_insolvent_driver ON public.rides;
CREATE TRIGGER trigger_prevent_insolvent_driver
    BEFORE INSERT ON public.rides
    FOR EACH ROW
    EXECUTE FUNCTION public.prevent_insolvent_driver_publishing();
