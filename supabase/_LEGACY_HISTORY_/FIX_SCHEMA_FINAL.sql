-- ========================================================
-- MIGRACIÓN FINAL: SINCRONIZACIÓN DE ESQUEMA CRÍTICO
-- Objetivo: Resolver discrepancias en tablas rides y ride_requests
-- ========================================================

DO $$ 
BEGIN 
    -- 1. TABLA RIDE_REQUESTS
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ride_requests' AND column_name='payment_expires_at') THEN
        ALTER TABLE public.ride_requests ADD COLUMN payment_expires_at TIMESTAMPTZ;
    END IF;

    -- 2. TABLA RIDES
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='rides' AND column_name='payment_expires_at') THEN
        ALTER TABLE public.rides ADD COLUMN payment_expires_at TIMESTAMPTZ;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='rides' AND column_name='co2_saved') THEN
        ALTER TABLE public.rides ADD COLUMN co2_saved DECIMAL DEFAULT 0;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='rides' AND column_name='initial_price') THEN
        ALTER TABLE public.rides ADD COLUMN initial_price NUMERIC(10, 2) DEFAULT 0.00;
    END IF;

    -- 3. TABLA RIDE_PASSENGERS (Si existe, algunas migraciones la mencionan)
    -- Si no existe, la creamos para evitar errores de referencia en RPCs antiguos
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='ride_passengers') THEN
        CREATE TABLE public.ride_passengers (
            id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
            ride_id UUID REFERENCES public.rides(id) ON DELETE CASCADE,
            passenger_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
            passenger_name TEXT,
            passenger_photo_url TEXT,
            pickup_point JSONB,
            status TEXT DEFAULT 'confirmed',
            payment_status TEXT DEFAULT 'pending',
            held_amount DECIMAL,
            payment_expires_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ DEFAULT NOW()
        );
    END IF;
END $$;

-- 4. RE-COMPILAR RPC GET_RIDE_DETAILS_SECURE (Sin referencias a columnas potencialmente inexistentes)
CREATE OR REPLACE FUNCTION public.get_ride_details_secure(p_ride_id UUID) RETURNS JSON AS $$
DECLARE v_ride_data RECORD;
BEGIN
    SELECT r.*,
        p.display_name as driver_name,
        p.photo_url as driver_photo,
        (
            SELECT jsonb_agg(
                    jsonb_set(pax, '{pin}', '"****"') -- Ocultar PINs por seguridad
                )
            FROM jsonb_array_elements(COALESCE(r.passengers, '[]'::jsonb)) pax
        ) as safe_passengers INTO v_ride_data
    FROM public.rides r
        LEFT JOIN public.profiles p ON r.driver_id = p.id
    WHERE r.id = p_ride_id;

    IF v_ride_data IS NULL THEN 
        RETURN json_build_object('success', false, 'error', 'No encontrado');
    END IF;

    RETURN json_build_object(
        'success', true,
        'data', row_to_json(v_ride_data)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
