-- ==========================================
-- FIX: fulfill_ride_request - Missing updated_at column
-- Fecha: 2026-02-07
-- Descripción: Agregar columna updated_at a ride_requests y
--              actualizar función fulfill_ride_request
-- ==========================================
-- Step 1: Add updated_at column to ride_requests table
ALTER TABLE public.ride_requests
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
-- Step 2: Create trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION public.update_ride_requests_updated_at() RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW();
RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trigger_update_ride_requests_updated_at ON public.ride_requests;
CREATE TRIGGER trigger_update_ride_requests_updated_at BEFORE
UPDATE ON public.ride_requests FOR EACH ROW EXECUTE FUNCTION public.update_ride_requests_updated_at();
-- Step 3: Update fulfill_ride_request function
-- Drop old versions first
DROP FUNCTION IF EXISTS public.fulfill_ride_request(
    UUID,
    JSONB,
    JSONB,
    TIMESTAMPTZ,
    INTEGER,
    DECIMAL,
    DECIMAL,
    JSONB
);
DROP FUNCTION IF EXISTS public.fulfill_ride_request(
    UUID,
    JSONB,
    JSONB,
    TIMESTAMPTZ,
    INTEGER,
    DECIMAL,
    TEXT,
    DECIMAL,
    TEXT,
    JSONB
);
-- Create the correct version with all parameters the frontend sends
CREATE OR REPLACE FUNCTION public.fulfill_ride_request(
        p_request_id UUID,
        p_origin JSONB,
        p_destination JSONB,
        p_departure_time TIMESTAMPTZ,
        p_seats INTEGER,
        p_price DECIMAL,
        p_details TEXT DEFAULT '',
        p_distance DECIMAL DEFAULT 0,
        p_overview_polyline TEXT DEFAULT NULL,
        p_waypoints JSONB DEFAULT '[]'::jsonb
    ) RETURNS JSON AS $$
DECLARE v_ride_result JSON;
v_ride_id UUID;
v_request_status TEXT;
v_requester_is_women_only BOOLEAN;
v_requester_id UUID;
v_driver_id UUID;
BEGIN -- Get current user
v_driver_id := auth.uid();
IF v_driver_id IS NULL THEN RAISE EXCEPTION 'No autenticado';
END IF;
-- 1. Validate request status
SELECT status,
    is_women_only,
    requester_id INTO v_request_status,
    v_requester_is_women_only,
    v_requester_id
FROM public.ride_requests
WHERE id = p_request_id FOR
UPDATE;
-- Lock the row
IF v_request_status IS NULL THEN RAISE EXCEPTION 'Solicitud no encontrada';
END IF;
IF v_request_status != 'pending' THEN RAISE EXCEPTION 'La solicitud ya no está disponible';
END IF;
-- Prevent accepting own request
IF v_requester_id = v_driver_id THEN RAISE EXCEPTION 'No puedes aceptar tu propia solicitud';
END IF;
-- 2. Create the ride
v_ride_result := public.create_ride(
    p_origin => p_origin,
    p_destination => p_destination,
    p_departure_time => p_departure_time,
    p_seats => p_seats,
    p_price => p_price,
    p_details => COALESCE(p_details, 'Viaje creado para aceptar solicitud'),
    p_distance => p_distance,
    p_overview_polyline => p_overview_polyline,
    p_bounds => NULL,
    p_is_women_only => COALESCE(v_requester_is_women_only, FALSE),
    p_is_exclusive_community => FALSE,
    p_allowed_communities => '{}',
    p_approval_mode => 'automatic'
);
-- Check if ride creation was successful
IF (v_ride_result->>'success')::BOOLEAN != TRUE THEN RAISE EXCEPTION 'Error al crear el viaje: %',
v_ride_result->>'error';
END IF;
v_ride_id := (v_ride_result->>'rideId')::UUID;
-- 3. Link request to ride
UPDATE public.ride_requests
SET status = 'accepted',
    matched_ride_id = v_ride_id
WHERE id = p_request_id;
-- 4. Auto-book the requester into the ride
-- This ensures the passenger gets a seat automatically
PERFORM public.confirm_trip_and_pay(v_ride_id, p_request_id);
RETURN json_build_object('success', true, 'rideId', v_ride_id);
EXCEPTION
WHEN OTHERS THEN RAISE EXCEPTION '%',
SQLERRM;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- Verify the function was created correctly
DO $$ BEGIN IF EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE proname = 'fulfill_ride_request'
        AND pg_get_function_identity_arguments(oid) LIKE '%p_overview_polyline%'
) THEN RAISE NOTICE '✅ Function fulfill_ride_request updated successfully';
ELSE RAISE WARNING '⚠️ Function may not have been created correctly';
END IF;
END $$;