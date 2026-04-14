-- 12. SEARCH RIDES SECURE (Elite Matching Engine)
CREATE OR REPLACE FUNCTION public.search_rides_secure(
        p_origin JSONB,
        p_destination JSONB,
        p_date DATE DEFAULT NULL,
        p_seats_needed INTEGER DEFAULT 1,
        p_max_price DECIMAL DEFAULT 999.99,
        p_max_dist_meters FLOAT DEFAULT 15000
    ) RETURNS TABLE (
        id UUID,
        driver_id UUID,
        driver_display_name TEXT,
        driver_photo_url TEXT,
        driver_rating DECIMAL,
        driver_eco_tier TEXT,
        driver_verified TEXT,
        origin JSONB,
        destination JSONB,
        departure_time TIMESTAMPTZ,
        seats_available INTEGER,
        price DECIMAL,
        distance DECIMAL,
        is_women_only BOOLEAN,
        passengers_count INTEGER,
        match_score FLOAT
    ) AS $$
DECLARE v_searcher_id UUID := auth.uid();
v_searcher_gender TEXT;
v_origin_geog GEOGRAPHY;
v_dest_geog GEOGRAPHY;
BEGIN IF v_searcher_id IS NOT NULL THEN
SELECT gender INTO v_searcher_gender
FROM public.profiles
WHERE id = v_searcher_id;
END IF;
v_origin_geog := ST_SetSRID(
    ST_MakePoint(
        (p_origin->>'lng')::FLOAT,
        (p_origin->>'lat')::FLOAT
    ),
    4326
)::GEOGRAPHY;
v_dest_geog := ST_SetSRID(
    ST_MakePoint(
        (p_destination->>'lng')::FLOAT,
        (p_destination->>'lat')::FLOAT
    ),
    4326
)::GEOGRAPHY;
RETURN QUERY
SELECT r.id,
    r.driver_id,
    r.driver_display_name,
    r.driver_photo_url,
    COALESCE(p.rating, 0.0)::DECIMAL AS driver_rating,
    p.eco_tier AS driver_eco_tier,
    (p.verification->>'status')::TEXT AS driver_verified,
    r.origin,
    r.destination,
    r.departure_time,
    r.seats_available,
    r.price,
    r.distance,
    r.is_women_only,
    COALESCE(jsonb_array_length(r.passengers), 0),
    (
        100.0 - (
            ST_Distance(r.origin_location, v_origin_geog) / 200.0
        ) - (
            ST_Distance(r.destination_location, v_dest_geog) / 200.0
        )
    )::FLOAT AS match_score
FROM public.rides r
    JOIN public.profiles p ON r.driver_id = p.id
WHERE r.status IN ('scheduled', 'active')
    AND r.departure_time > NOW()
    AND (
        p_date IS NULL
        OR r.departure_time::DATE = p_date
    )
    AND r.seats_available >= p_seats_needed
    AND r.price <= p_max_price
    AND ST_Distance(r.origin_location, v_origin_geog) < p_max_dist_meters
    AND ST_Distance(r.destination_location, v_dest_geog) < p_max_dist_meters
    AND r.driver_id != COALESCE(
        v_searcher_id,
        '00000000-0000-0000-0000-000000000000'::UUID
    )
    AND (
        NOT r.is_women_only
        OR (
            v_searcher_gender IS NULL
            OR v_searcher_gender = 'female'
        )
    )
ORDER BY match_score DESC,
    p.rating DESC,
    r.departure_time ASC
LIMIT 40;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
-- 13. FULFILL RIDE REQUEST (Driver accepts passenger request)
CREATE OR REPLACE FUNCTION public.fulfill_ride_request(
        p_request_id UUID,
        p_origin JSONB,
        p_destination JSONB,
        p_departure_time TIMESTAMPTZ,
        p_seats INTEGER,
        p_price DECIMAL,
        p_details TEXT DEFAULT '',
        p_distance DECIMAL DEFAULT NULL,
        p_overview_polyline TEXT DEFAULT NULL,
        p_waypoints JSONB DEFAULT '[]'::jsonb
    ) RETURNS JSON AS $$
DECLARE v_driver_id UUID := auth.uid();
v_passenger_id UUID;
v_passenger_name TEXT;
v_passenger_photo TEXT;
v_ride_id UUID;
v_ride_res JSON;
v_wallet_balance DECIMAL;
v_ride_pin TEXT;
v_passenger_obj JSONB;
BEGIN IF v_driver_id IS NULL THEN RAISE EXCEPTION 'No autenticado';
END IF;
SELECT requester_id INTO v_passenger_id
FROM public.ride_requests
WHERE id = p_request_id
    AND status = 'pending';
IF v_passenger_id IS NULL THEN RAISE EXCEPTION 'La solicitud ya no está disponible.';
END IF;
SELECT display_name,
    photo_url INTO v_passenger_name,
    v_passenger_photo
FROM public.profiles
WHERE id = v_passenger_id;
SELECT balance INTO v_wallet_balance
FROM public.wallets
WHERE user_id = v_passenger_id FOR
UPDATE;
IF v_wallet_balance < p_price THEN RAISE EXCEPTION 'El pasajero no tiene saldo suficiente.';
END IF;
SELECT public.create_ride(
        p_origin,
        p_destination,
        p_departure_time,
        p_seats,
        p_price,
        p_details,
        p_distance,
        p_overview_polyline,
        NULL,
        FALSE,
        FALSE,
        '{}',
        'automatic',
        p_waypoints,
        '{}'
    ) INTO v_ride_res;
IF NOT (v_ride_res->>'success')::BOOLEAN THEN RETURN v_ride_res;
END IF;
v_ride_id := (v_ride_res->>'rideId')::UUID;
v_ride_pin := LPAD(FLOOR(RANDOM() * 9000 + 1000)::TEXT, 4, '0');
UPDATE public.wallets
SET balance = balance - p_price,
    held_balance = held_balance + p_price
WHERE user_id = v_passenger_id;
INSERT INTO public.transactions (
        wallet_id,
        user_id,
        type,
        amount,
        balance_after,
        description,
        related_ride_id
    )
SELECT id,
    user_id,
    'hold',
    - p_price,
    balance,
    'Reserva automática por Match',
    v_ride_id
FROM public.wallets
WHERE user_id = v_passenger_id;
v_passenger_obj := json_build_object(
    'id',
    v_passenger_id,
    'displayName',
    v_passenger_name,
    'photoURL',
    v_passenger_photo,
    'status',
    'confirmed',
    'pin',
    v_ride_pin,
    'booked_price',
    p_price,
    'booked_at',
    NOW()
)::JSONB;
UPDATE public.rides
SET passengers = jsonb_build_array(v_passenger_obj),
    participant_ids = array_append(participant_ids, v_passenger_id),
    seats_available = seats_available - 1
WHERE id = v_ride_id;
UPDATE public.ride_requests
SET status = 'fulfilled',
    matched_ride_id = v_ride_id
WHERE id = p_request_id;
RETURN json_build_object('success', true, 'rideId', v_ride_id);
EXCEPTION
WHEN OTHERS THEN
INSERT INTO public.rpc_error_logs (
        function_name,
        error_message,
        error_detail,
        user_id,
        params
    )
VALUES (
        'fulfill_ride_request',
        SQLERRM,
        SQLSTATE,
        v_driver_id,
        json_build_object('request_id', p_request_id)
    );
RAISE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;