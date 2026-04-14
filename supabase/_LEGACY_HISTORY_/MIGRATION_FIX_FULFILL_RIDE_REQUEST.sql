-- ==========================================
-- MIGRATION: FIX_FULFILL_RIDE_REQUEST
-- Fixes the function signature call to create_ride
-- ==========================================

CREATE OR REPLACE FUNCTION public.fulfill_ride_request(
    p_request_id UUID,
    p_origin JSONB,
    p_destination JSONB,
    p_departure_time TIMESTAMPTZ,
    p_seats INTEGER,
    p_price DECIMAL,
    p_distance DECIMAL DEFAULT 0,
    p_waypoints JSONB DEFAULT '[]'::jsonb
) RETURNS JSON AS $$
DECLARE
    v_ride_result JSON;
    v_ride_id UUID;
    v_request_status TEXT;
    v_requester_is_women_only BOOLEAN;
BEGIN
    -- 1. Validar estado de la solicitud
    SELECT status, is_women_only INTO v_request_status, v_requester_is_women_only 
    FROM public.ride_requests WHERE id = p_request_id;
    
    IF v_request_status IS NULL THEN RAISE EXCEPTION 'Solicitud no encontrada'; END IF;
    IF v_request_status != 'pending' THEN RAISE EXCEPTION 'La solicitud ya no está pendiente'; END IF;

    -- 2. Crear el viaje (usando la firma actualizada de create_ride)
    -- create_ride devuelve un JSON { "success": true, "rideId": "..." }
    -- Mapeamos explícitamente los parámetros para evitar errores de firma "does not exist"
    v_ride_result := public.create_ride(
        p_origin => p_origin,
        p_destination => p_destination,
        p_departure_time => p_departure_time,
        p_seats => p_seats,
        p_price => p_price,
        p_details => 'Viaje creado para aceptar solicitud',
        p_distance => p_distance,
        p_overview_polyline => NULL,
        p_bounds => NULL,
        p_is_women_only => COALESCE(v_requester_is_women_only, FALSE), -- Respetar preferencia de género
        p_is_exclusive_community => FALSE,
        p_allowed_communities => '{}',
        p_approval_mode => 'automatic',
        p_waypoints => p_waypoints,
        p_preferences => '{}'::jsonb
    );

    v_ride_id := (v_ride_result->>'rideId')::UUID;

    -- 3. Vincular solicitud
    UPDATE public.ride_requests
    SET status = 'accepted',
        matched_ride_id = v_ride_id,
        updated_at = NOW()
    WHERE id = p_request_id;

    RETURN json_build_object('success', true, 'rideId', v_ride_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
