-- ==============================================================================
-- ATOMIC PAYMENTS FIX: PREVENCIÓN DE RACE CONDITIONS Y DOBLE GASTO
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.confirm_trip_and_pay(
    p_ride_id UUID,
    p_request_id UUID DEFAULT NULL,
    p_pickup_address TEXT DEFAULT NULL,
    p_pickup_location JSONB DEFAULT NULL,
    p_price DECIMAL DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
    v_me UUID := auth.uid();
    v_ride_record RECORD;
    v_wallet_record RECORD;
    v_pin TEXT;
    v_final_price NUMERIC;
BEGIN
    -- 1. BLOQUEO DE VIAJE: Evita que otro reserve mientras procesamos
    SELECT * INTO v_ride_record
    FROM public.rides
    WHERE id = p_ride_id AND status = 'scheduled'
    FOR UPDATE;

    IF v_ride_record.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'VIAJE_NO_DISPONIBLE');
    END IF;

    IF v_ride_record.seats_available <= 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'SIN_PLAZAS');
    END IF;

    -- 2. BLOQUEO DE WALLET: Evita doble gasto si el usuario hace dos clics rápidos
    SELECT * INTO v_wallet_record
    FROM public.wallets
    WHERE user_id = v_me
    FOR UPDATE;

    v_final_price := COALESCE(p_price, v_ride_record.price);

    -- 3. VALIDACIÓN DE SALDO
    IF v_wallet_record.balance < v_final_price THEN
        RETURN jsonb_build_object('success', false, 'error', 'SALDO_INSUFICIENTE', 'required', v_final_price, 'current', v_wallet_record.balance);
    END IF;

    -- 4. PROCESO ATÓMICO: Pin -> Wallet -> Ride -> Transaction
    v_pin := LPAD(FLOOR(RANDOM() * 9000 + 1000)::TEXT, 4, '0');

    -- Actualizar carteras (Mover a saldo retenido/escrow)
    UPDATE public.wallets
    SET balance = balance - v_final_price,
        held_balance = held_balance + v_final_price,
        updated_at = NOW()
    WHERE user_id = v_me;

    -- Registrar transacción
    INSERT INTO public.transactions (user_id, amount, type, description, related_ride_id)
    VALUES (v_me, -v_final_price, 'booking_payment', 'Reserva de viaje: ' || p_ride_id, p_ride_id);

    -- Actualizar viaje
    UPDATE public.rides
    SET seats_available = seats_available - 1,
        participant_ids = array_append(participant_ids, v_me),
        passengers = COALESCE(passengers, '[]'::JSONB) || jsonb_build_object(
            'id', v_me,
            'status', 'confirmed',
            'pin', v_pin,
            'booked_price', v_final_price,
            'pickup_address', p_pickup_address,
            'created_at', NOW()
        )
    WHERE id = p_ride_id;

    RETURN jsonb_build_object('success', true, 'pin', v_pin, 'rideId', p_ride_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
