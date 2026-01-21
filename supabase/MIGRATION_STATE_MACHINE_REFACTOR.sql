-- ==========================================
-- MIGRATION: UNIFIED_STATE_MACHINE_V2
-- Refactors Ride and Passenger statuses to follow the new blueprint
-- ==========================================
-- 1. Update RIDES table status constraint
ALTER TABLE public.rides DROP CONSTRAINT IF EXISTS rides_status_check;
ALTER TABLE public.rides
ADD CONSTRAINT rides_status_check CHECK (
        status IN (
            'scheduled',
            'active',
            'in_progress',
            'completed',
            'cancelled'
        )
    );
-- 2. Update RIDE_REQUESTS table status constraint
ALTER TABLE public.ride_requests DROP CONSTRAINT IF EXISTS ride_requests_status_check;
ALTER TABLE public.ride_requests
ADD CONSTRAINT ride_requests_status_check CHECK (
        status IN (
            'pending',
            'confirmed',
            'rejected',
            'cancelled',
            'on_board',
            'completed',
            'no_show',
            'disputed'
        )
    );
-- 3. Update START_RIDE RPC
CREATE OR REPLACE FUNCTION public.start_ride(p_ride_id UUID) RETURNS JSON AS $$
DECLARE v_driver_id UUID;
v_has_onboard BOOLEAN;
BEGIN v_driver_id := auth.uid();
-- Check if there is at least one passenger on_board
SELECT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(passengers) AS p
        WHERE p->>'status' = 'on_board'
    ) INTO v_has_onboard
FROM public.rides
WHERE id = p_ride_id;
IF NOT v_has_onboard THEN RAISE EXCEPTION 'No puedes iniciar el viaje sin haber validado al menos un PIN de pasajero.';
END IF;
UPDATE public.rides
SET status = 'in_progress',
    last_modified_at = NOW()
WHERE id = p_ride_id
    AND driver_id = v_driver_id
    AND status IN ('scheduled', 'active');
IF NOT FOUND THEN RAISE EXCEPTION 'No se pudo iniciar el viaje. Verifica el estado actual.';
END IF;
RETURN json_build_object('success', true, 'status', 'in_progress');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 4. Update COMPLETE_RIDE RPC (With automatic passenger completion)
CREATE OR REPLACE FUNCTION public.complete_ride(p_ride_id UUID) RETURNS JSON AS $$
DECLARE v_driver_id UUID;
v_ride_record RECORD;
v_passenger JSONB;
v_updated_passengers JSONB := '[]'::jsonb;
v_p_amount DECIMAL;
v_p_id UUID;
BEGIN v_driver_id := auth.uid();
SELECT * INTO v_ride_record
FROM public.rides
WHERE id = p_ride_id
    AND driver_id = v_driver_id FOR
UPDATE;
IF v_ride_record.status != 'in_progress' THEN RAISE EXCEPTION 'Solo puedes completar un viaje que esté en progreso.';
END IF;
-- Process each passenger
FOR v_passenger IN
SELECT *
FROM jsonb_array_elements(v_ride_record.passengers) LOOP v_p_id := (v_passenger->>'id')::UUID;
v_p_amount := (v_passenger->>'booked_price')::DECIMAL;
-- If passenger was on_board, complete them and trigger payment to driver
IF v_passenger->>'status' = 'on_board' THEN v_passenger := v_passenger || jsonb_build_object('status', 'completed', 'completed_at', NOW());
-- Transfer funds from HELD to Driver Balance (Simplified for this script)
UPDATE public.wallets
SET held_balance = held_balance - v_p_amount
WHERE user_id = v_p_id;
UPDATE public.wallets
SET balance = balance + v_p_amount
WHERE user_id = v_driver_id;
INSERT INTO public.transactions (
        user_id,
        type,
        amount,
        description,
        related_ride_id
    )
VALUES (
        v_driver_id,
        'income',
        v_p_amount,
        'Pago recibido por viaje completado',
        p_ride_id
    );
END IF;
v_updated_passengers := v_updated_passengers || v_passenger;
LOOP;
UPDATE public.rides
SET status = 'completed',
    passengers = v_updated_passengers,
    completed_at = NOW()
WHERE id = p_ride_id;
RETURN json_build_object('success', true, 'status', 'completed');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 5. Update VERIFY_PASSENGER (PIN)
CREATE OR REPLACE FUNCTION public.verify_passenger(p_ride_id UUID, p_passenger_id UUID, p_pin TEXT) RETURNS JSON AS $$
DECLARE v_driver_id UUID;
v_ride_record RECORD;
v_passenger JSONB;
v_updated_passengers JSONB := '[]'::jsonb;
v_found BOOLEAN := FALSE;
BEGIN v_driver_id := auth.uid();
SELECT * INTO v_ride_record
FROM public.rides
WHERE id = p_ride_id
    AND driver_id = v_driver_id FOR
UPDATE;
FOR v_passenger IN
SELECT *
FROM jsonb_array_elements(v_ride_record.passengers) LOOP IF (v_passenger->>'id')::UUID = p_passenger_id THEN IF v_passenger->>'pin' = p_pin THEN v_passenger := v_passenger || jsonb_build_object('status', 'on_board', 'verified_at', NOW());
v_found := TRUE;
ELSE RAISE EXCEPTION 'PIN incorrecto.';
END IF;
END IF;
v_updated_passengers := v_updated_passengers || v_passenger;
LOOP;
IF NOT v_found THEN RAISE EXCEPTION 'Pasajero no encontrado en este viaje.';
END IF;
UPDATE public.rides
SET passengers = v_updated_passengers
WHERE id = p_ride_id;
-- Sync ride_requests table
UPDATE public.ride_requests
SET status = 'on_board'
WHERE ride_id = p_ride_id
    AND requester_id = p_passenger_id;
RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;