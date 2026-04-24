-- ==============================================================================
-- 🚀 SHAREWAY ULTIMATE STABLE FIX V14.3 (Ironclad Consistency Edition)
-- ==============================================================================

-- 1. LIMPIEZA QUIRÚRGICA DE DUPLICADOS
-- Mantenemos solo el registro más reciente por cada par (viaje, usuario)
DELETE FROM public.ride_ratings
WHERE id IN (
    SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY ride_id, sender_id ORDER BY created_at DESC) as row_num
        FROM public.ride_ratings
    ) t WHERE t.row_num > 1
);

-- 2. RESTRICCIONES DE INTEGRIDAD
-- Forzamos la unicidad para que el ON CONFLICT funcione siempre
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ride_ratings_ride_id_sender_id_key') THEN
        ALTER TABLE public.ride_ratings ADD CONSTRAINT ride_ratings_ride_id_sender_id_key UNIQUE (ride_id, sender_id);
    END IF;
END $$;

-- 3. MOTOR DE RATINGS RECONSTRUIDO
CREATE OR REPLACE FUNCTION public.rate_ride(p_ride_id UUID, p_rating INTEGER, p_comment TEXT DEFAULT '') RETURNS JSON AS $$
DECLARE
    v_driver_id UUID;
    v_avg_rating DECIMAL;
    v_updated_passengers JSONB;
BEGIN
    -- 1. Obtener ID del conductor con bloqueo
    SELECT driver_id INTO v_driver_id FROM public.rides WHERE id = p_ride_id FOR UPDATE;

    -- 2. Insertar valoración (Atomicamente)
    INSERT INTO public.ride_ratings (ride_id, sender_id, receiver_id, rating, comment)
    VALUES (p_ride_id, auth.uid(), v_driver_id, p_rating, p_comment)
    ON CONFLICT (ride_id, sender_id) DO UPDATE
    SET rating = p_rating, comment = p_comment, created_at = NOW();

    -- 3. Actualizar promedio del conductor
    SELECT AVG(rating)::DECIMAL(3,2) INTO v_avg_rating FROM public.ride_ratings WHERE receiver_id = v_driver_id;
    UPDATE public.profiles SET rating = v_avg_rating WHERE id = v_driver_id;

    -- 4. Actualizar estado del pasajero en el JSONB (Crucial para el Frontend)
    UPDATE public.rides
    SET passengers = (
        SELECT jsonb_agg(
            CASE
                WHEN (p->>'id') = auth.uid()::TEXT THEN p || '{"rated": true}'::jsonb
                ELSE p
            END
        ) FROM jsonb_array_elements(passengers) p
    )
    WHERE id = p_ride_id
    RETURNING passengers INTO v_updated_passengers;

    -- 5. NOTIFICACIÓN AL CONDUCTOR (Unificado con esquema 'body')
    INSERT INTO public.notifications (user_id, type, title, body, data)
    VALUES (
        v_driver_id,
        'success',
        '¡Nueva valoración recibida! ⭐',
        'Un pasajero te ha calificado con ' || p_rating || ' estrellas en tu último viaje.',
        jsonb_build_object('ride_id', p_ride_id, 'rating', p_rating)
    );

    RETURN json_build_object(
        'success', true,
        'new_rating', v_avg_rating,
        'passengers', v_updated_passengers
    );
END; $$ LANGUAGE plpgsql SECURITY DEFINER;

NOTIFY pgrst, 'reload schema';
