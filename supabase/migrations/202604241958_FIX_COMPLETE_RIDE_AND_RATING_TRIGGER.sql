-- 🚀 SHAREWAY ELITE - CONSOLIDATED FIX (V16.4)
-- Final fix for complete_ride and get_ride_details_secure

-- 1. LIMPIEZA DE FUNCIONES PREVIAS PARA EVITAR OVERLOADING
DROP FUNCTION IF EXISTS public.complete_ride(uuid);
DROP FUNCTION IF EXISTS public.complete_ride(uuid, decimal, decimal);

-- 2. REPARACIÓN DE complete_ride (Extracción JSONB Correcta)
CREATE OR REPLACE FUNCTION public.complete_ride(p_ride_id UUID)
RETURNS JSON AS $$
DECLARE
    v_driver_id UUID := auth.uid();
    v_ride_record RECORD;
    v_passenger JSONB;
    v_total_payout DECIMAL := 0;
    v_payout_neto DECIMAL;
    v_passenger_id UUID;
    v_passenger_price DECIMAL;
    v_origin_txt TEXT;
    v_dest_txt TEXT;
BEGIN
    -- Bloqueo de seguridad y obtención de datos
    SELECT * INTO v_ride_record FROM public.rides WHERE id = p_ride_id FOR UPDATE;

    IF v_ride_record IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'Viaje no encontrado');
    END IF;

    -- Extraer direcciones correctamente de las columnas JSONB 'origin' y 'destination'
    v_origin_txt := COALESCE(v_ride_record.origin->>'address', v_ride_record.origin->>'name', 'Origen');
    v_dest_txt := COALESCE(v_ride_record.destination->>'address', v_ride_record.destination->>'name', 'Destino');

    -- PROCESAMIENTO DE PAGOS
    FOR v_passenger IN SELECT * FROM jsonb_array_elements(COALESCE(v_ride_record.passengers, '[]'::jsonb))
    LOOP
        v_passenger_id := (v_passenger->>'id')::UUID;
        v_passenger_price := COALESCE((v_passenger->>'booked_price')::DECIMAL, v_ride_record.price);

        IF v_passenger->>'status' IN ('confirmed', 'verified') THEN
            v_total_payout := v_total_payout + v_passenger_price;

            -- Descontar del saldo retenido (Escrow)
            UPDATE public.wallets
            SET held_balance = GREATEST(0, held_balance - v_passenger_price),
                updated_at = NOW()
            WHERE user_id = v_passenger_id;

            -- Historial para el pasajero
            INSERT INTO public.transactions (user_id, amount, type, description, related_ride_id)
            VALUES (v_passenger_id, -v_passenger_price, 'ride_payment', 'Pago viaje: ' || v_origin_txt || ' -> ' || v_dest_txt, p_ride_id);
        END IF;
    END LOOP;

    -- PAGO NETO CONDUCTOR (90%)
    v_payout_neto := v_total_payout * 0.90;

    IF v_payout_neto > 0 THEN
        UPDATE public.wallets SET balance = balance + v_payout_neto, updated_at = NOW() WHERE user_id = v_driver_id;
        INSERT INTO public.transactions (user_id, amount, type, description, related_ride_id)
        VALUES (v_driver_id, v_payout_neto, 'payout', 'Cobro viaje: ' || v_origin_txt || ' -> ' || v_dest_txt, p_ride_id);
    END IF;

    -- MARCAR COMO COMPLETADO
    UPDATE public.rides SET status = 'completed', completed_at = NOW() WHERE id = p_ride_id;

    RETURN json_build_object('success', true, 'payout', v_payout_neto);

EXCEPTION WHEN OTHERS THEN
    RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. REPARACIÓN DE get_ride_details_secure (Incluir estado de Rating)
CREATE OR REPLACE FUNCTION public.get_ride_details_secure(p_ride_id UUID)
RETURNS JSON AS $$
DECLARE
    v_is_driver BOOLEAN;
    v_user_id   UUID := auth.uid()::UUID;
BEGIN
    SELECT (driver_id = v_user_id) INTO v_is_driver
    FROM public.rides WHERE id = p_ride_id;

    RETURN (
        SELECT json_build_object(
            'success', true,
            'data', json_build_object(
                'id',                  r.id,
                'driver_id',           r.driver_id,
                'status',              r.status,
                'origin',              r.origin,
                'destination',         r.destination,
                'origin_address',      COALESCE(r.origin->>'address', r.origin->>'name', 'Origen'),
                'destination_address', COALESCE(r.destination->>'address', r.destination->>'name', 'Destino'),
                'departure_time',      r.departure_time,
                'price',               r.price,
                'seats_available',     r.seats_available,
                'total_seats',         4,
                'overview_polyline',   r.overview_polyline,
                'vehicle_model',       COALESCE(r.details, 'Vehículo ShareWay'),
                'vehicle_plate',       '••••',
                'driver', json_build_object(
                    'id',           p.id,
                    'display_name', COALESCE(p.display_name, p.full_name, 'Conductor'),
                    'avatar_url',   p.photo_url,
                    'rating',       COALESCE(p.rating, 5.0),
                    'verified',     COALESCE(p.is_verified, false)
                ),
                'passengers', (
                    SELECT jsonb_agg(
                        jsonb_build_object(
                            'id',              prof.id,
                            'displayName',     COALESCE(prof.display_name, prof.full_name),
                            'avatarUrl',       prof.photo_url,
                            'status',          elem.val->>'status',
                            'rated',           COALESCE((elem.val->>'rated')::BOOLEAN, false),
                            'pin', CASE
                                WHEN (elem.val->>'id')::UUID = v_user_id OR v_is_driver
                                THEN elem.val->>'pin'
                                ELSE '****'
                            END
                        )
                    )
                    FROM jsonb_array_elements(COALESCE(r.passengers, '[]'::jsonb)) AS elem(val)
                    JOIN public.profiles prof ON (elem.val->>'id')::UUID = prof.id
                    WHERE elem.val->>'status' != 'cancelled'
                )
            )
        )
        FROM public.rides r
        JOIN public.profiles p ON r.driver_id = p.id
        WHERE r.id = p_ride_id
    );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
