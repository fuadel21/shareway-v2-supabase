-- Stripe webhook confirms card bookings via fulfill_booking_after_payment.
-- That RPC was dropped; without it PaymentIntents succeed but the passenger
-- never joins the ride, which is the "banco confirmó / internet lento" screen.

CREATE OR REPLACE FUNCTION public.transition_financial_status(
    p_stripe_id TEXT,
    p_new_status TEXT,
    p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    RETURN jsonb_build_object(
        'success', true,
        'stripe_id', p_stripe_id,
        'status', p_new_status
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.fulfill_booking_after_payment(
    p_user_id UUID,
    p_ride_id UUID,
    p_amount NUMERIC,
    p_payment_intent_id TEXT,
    p_wallet_deduction NUMERIC DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_ride public.rides%ROWTYPE;
    v_request public.ride_requests%ROWTYPE;
    v_request_row jsonb;
    v_already boolean := false;
    v_seats integer := 1;
    v_pin text;
    v_price numeric;
    v_name text;
    v_photo text;
    v_passenger jsonb;
BEGIN
    IF p_user_id IS NULL OR p_ride_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Faltan datos de reserva');
    END IF;

    SELECT * INTO v_ride
    FROM public.rides
    WHERE id = p_ride_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Viaje no encontrado');
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(COALESCE(v_ride.passengers, '[]'::jsonb)) AS passenger
        WHERE lower(COALESCE(passenger->>'id', passenger->>'user_id', '')) = lower(p_user_id::text)
          AND lower(COALESCE(passenger->>'status', '')) IN (
            'confirmed', 'accepted', 'pending_boarding', 'verified', 'completed'
          )
    ) INTO v_already;

    IF v_already THEN
        UPDATE public.ride_requests
        SET status = 'fulfilled'
        WHERE ride_id = p_ride_id
          AND requester_id = p_user_id
          AND lower(COALESCE(status, '')) IN ('pending', 'requested', 'awaiting_payment', 'processing', 'unpaid');

        RETURN jsonb_build_object('success', true, 'message', 'Ya es pasajero.');
    END IF;

    SELECT *
      INTO v_request
    FROM public.ride_requests
    WHERE ride_id = p_ride_id
      AND requester_id = p_user_id
      AND (
        payment_intent_id = p_payment_intent_id
        OR lower(COALESCE(status, '')) IN ('pending', 'requested', 'awaiting_payment', 'processing', 'unpaid')
      )
    ORDER BY CASE WHEN payment_intent_id = p_payment_intent_id THEN 0 ELSE 1 END
    LIMIT 1;

    v_request_row := COALESCE(to_jsonb(v_request), '{}'::jsonb);
    BEGIN
        v_seats := GREATEST(COALESCE(NULLIF(v_request_row->>'seats_needed', '')::int, NULLIF(v_request_row->>'num_seats', '')::int, 1), 1);
    EXCEPTION WHEN others THEN
        v_seats := 1;
    END;

    v_price := COALESCE(NULLIF(v_request_row->>'amount', '')::numeric, p_amount, 0) + COALESCE(p_wallet_deduction, 0);
    v_pin := NULLIF(v_request_row->>'pin', '');
    IF v_pin IS NULL OR v_pin !~ '^[0-9]{4,8}$' THEN
        v_pin := lpad(floor(random() * 9000 + 1000)::int::text, 4, '0');
    END IF;

    IF v_ride.status IS DISTINCT FROM 'scheduled' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Este viaje ya no admite reservas');
    END IF;

    IF COALESCE(v_ride.seats_available, 0) < v_seats THEN
        RETURN jsonb_build_object('success', false, 'error', 'No hay asientos. El cobro debe reembolsarse.');
    END IF;

    SELECT display_name, photo_url
      INTO v_name, v_photo
    FROM public.profiles
    WHERE id = p_user_id;

    v_passenger := jsonb_build_object(
        'id', p_user_id,
        'displayName', COALESCE(v_name, 'Pasajero'),
        'photoURL', v_photo,
        'status', 'confirmed',
        'pin', v_pin,
        'booked_price', v_price,
        'seats_booked', v_seats,
        'num_seats', v_seats,
        'payment_method', 'stripe',
        'payment_intent_id', p_payment_intent_id,
        'booked_at', NOW(),
        'pickup_location', v_request_row->'pickup_location',
        'pickup_address', v_request_row->>'pickup_address'
    );

    UPDATE public.rides
    SET
        passengers = COALESCE(passengers, '[]'::jsonb) || v_passenger,
        participant_ids = CASE
            WHEN participant_ids IS NULL THEN ARRAY[p_user_id]
            WHEN p_user_id = ANY(participant_ids) THEN participant_ids
            ELSE array_append(participant_ids, p_user_id)
        END,
        updated_at = NOW()
    WHERE id = p_ride_id;

    IF v_request.id IS NOT NULL THEN
        UPDATE public.ride_requests
        SET status = 'fulfilled'
        WHERE id = v_request.id;
    END IF;

    RETURN jsonb_build_object('success', true, 'pin', v_pin);
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_stripe_booking(
    p_ride_id UUID,
    p_payment_intent_id TEXT,
    p_pickup_location JSONB DEFAULT NULL,
    p_pickup_address TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id uuid := auth.uid();
    v_amount numeric := 0;
BEGIN
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
    END IF;

    SELECT COALESCE(amount, 0)
      INTO v_amount
    FROM public.ride_requests
    WHERE ride_id = p_ride_id
      AND requester_id = v_user_id
      AND payment_intent_id = p_payment_intent_id
    LIMIT 1;

    IF p_pickup_location IS NOT NULL OR p_pickup_address IS NOT NULL THEN
        UPDATE public.ride_requests
        SET
            pickup_location = COALESCE(p_pickup_location, pickup_location),
            pickup_address = COALESCE(p_pickup_address, pickup_address)
        WHERE ride_id = p_ride_id
          AND requester_id = v_user_id
          AND payment_intent_id = p_payment_intent_id;
    END IF;

    RETURN public.fulfill_booking_after_payment(
        v_user_id,
        p_ride_id,
        COALESCE(v_amount, 0),
        p_payment_intent_id,
        0
    );
END;
$$;

REVOKE ALL ON FUNCTION public.transition_financial_status(text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transition_financial_status(text, text, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.fulfill_booking_after_payment(uuid, uuid, numeric, text, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fulfill_booking_after_payment(uuid, uuid, numeric, text, numeric) TO service_role;

REVOKE ALL ON FUNCTION public.confirm_stripe_booking(uuid, text, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_stripe_booking(uuid, text, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_stripe_booking(uuid, text, jsonb, text) TO service_role;
