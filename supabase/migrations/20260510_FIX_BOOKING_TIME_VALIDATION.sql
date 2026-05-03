-- ==============================================================================
-- 20260510_FIX_BOOKING_TIME_VALIDATION.sql
-- Refuerzo de Seguridad: Impedir reservas de viajes cuya fecha de salida ya pasó.
-- ==============================================================================

-- 0. Limpieza para evitar conflictos de firma
DROP FUNCTION IF EXISTS public.confirm_trip_and_pay(uuid, uuid, text, jsonb, numeric, integer);

CREATE OR REPLACE FUNCTION public.confirm_trip_and_pay(
    p_ride_id UUID,
    p_request_id UUID DEFAULT NULL,
    p_pickup_address TEXT DEFAULT NULL,
    p_pickup_location JSONB DEFAULT NULL,
    p_price DECIMAL DEFAULT NULL,
    p_num_seats INTEGER DEFAULT 1
) RETURNS JSON AS $$
DECLARE
    v_me UUID := auth.uid();
    v_val_price NUMERIC;
    v_val_seats INTEGER;
    v_val_departure TIMESTAMPTZ;
    v_my_balance NUMERIC;
    v_pin TEXT;
    v_total_cost NUMERIC;
BEGIN
    -- 1. Bloqueo y obtención de datos del viaje (FOR UPDATE evita condiciones de carrera)
    SELECT price, seats_available, departure_time
    INTO v_val_price, v_val_seats, v_val_departure
    FROM public.rides
    WHERE id = p_ride_id AND status = 'scheduled' FOR UPDATE;

    -- A. Validar existencia y estado
    IF v_val_price IS NULL THEN
        RAISE EXCEPTION 'VIAJE_NO_DISPONIBLE';
    END IF;

    -- B. VALIDACIÓN CRÍTICA DE TIEMPO
    -- No permitir reservar si el viaje ya debería haber salido
    IF v_val_departure < NOW() THEN
        RAISE EXCEPTION 'EL_VIAJE_YA_SALIO';
    END IF;

    -- C. Validar disponibilidad de plazas
    IF v_val_seats < p_num_seats THEN
        RAISE EXCEPTION 'PLAZAS_INSUFICIENTES';
    END IF;

    -- 2. Calcular costo total
    v_total_cost := COALESCE(p_price, v_val_price) * p_num_seats;

    -- 3. Verificar saldo de la cartera
    SELECT balance INTO v_my_balance FROM public.wallets WHERE user_id = v_me FOR UPDATE;

    IF v_my_balance < v_total_cost THEN
        RAISE EXCEPTION 'SALDO_INSUFICIENTE';
    END IF;

    -- 4. Generar PIN de abordaje
    v_pin := LPAD(FLOOR(RANDOM() * 9000 + 1000)::TEXT, 4, '0');

    -- 5. Transacción financiera (Escrow)
    UPDATE public.wallets
    SET balance = balance - v_total_cost,
        held_balance = held_balance + v_total_cost
    WHERE user_id = v_me;

    -- 6. Actualización del viaje y registro de pasajero
    UPDATE public.rides
    SET seats_available = seats_available - p_num_seats,
        participant_ids = array_append(participant_ids, v_me),
        passengers = COALESCE(passengers, '[]'::JSONB) || jsonb_build_object(
            'id', v_me,
            'status', 'confirmed',
            'pin', v_pin,
            'booked_price', COALESCE(p_price, v_val_price),
            'seats_booked', p_num_seats,
            'pickup_address', p_pickup_address,
            'booked_at', NOW()
        )
    WHERE id = p_ride_id;

    -- 7. Registrar transacción de "congelamiento" de fondos
    INSERT INTO public.transactions (user_id, amount, type, description, related_ride_id)
    VALUES (v_me, -v_total_cost, 'payment', 'Reserva de viaje (Fondos retenidos)', p_ride_id);

    RETURN json_build_object(
        'success', true,
        'pin', v_pin,
        'total_paid', v_total_cost,
        'departure_time', v_val_departure,
        'new_balance', (v_my_balance - v_total_cost)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
