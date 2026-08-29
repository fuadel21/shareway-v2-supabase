-- Verify PIN without auto-starting the ride, and refuse start while any
-- booked passenger is unpaid or still waiting for PIN / no-show resolution.

CREATE OR REPLACE FUNCTION public.verify_passenger_boarding(
    p_ride_id UUID,
    p_pin TEXT,
    p_passenger_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_ride public.rides%ROWTYPE;
    v_pin TEXT := btrim(COALESCE(p_pin, ''));
    v_target TEXT := NULLIF(p_passenger_id::TEXT, '');
    v_updated BOOLEAN := FALSE;
    v_already BOOLEAN := FALSE;
    v_match_count INTEGER := 0;
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED', 'message', 'Debes iniciar sesión.');
    END IF;

    IF v_pin = '' OR v_pin !~ '^[0-9]{4,8}$' THEN
        RETURN jsonb_build_object('success', false, 'error', 'PIN_INCORRECTO', 'message', 'Introduce un PIN válido.');
    END IF;

    SELECT * INTO v_ride
    FROM public.rides
    WHERE id = p_ride_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'VIAJE_NO_ENCONTRADO', 'message', 'Viaje no encontrado');
    END IF;

    IF v_ride.driver_id IS DISTINCT FROM auth.uid() THEN
        RETURN jsonb_build_object('success', false, 'error', 'NO_AUTORIZADO', 'message', 'Solo el conductor puede verificar el embarque.');
    END IF;

    IF v_ride.status NOT IN ('scheduled', 'active', 'in_progress') THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'ESTADO_INVALIDO',
            'message', 'El viaje no está en un estado que permita embarque (Estado: ' || v_ride.status || ')'
        );
    END IF;

    IF v_ride.status = 'scheduled'
       AND v_ride.departure_time IS NOT NULL
       AND v_ride.departure_time > (NOW() + INTERVAL '15 minutes') THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'DEMASIADO_PRONTO',
            'message', 'No puedes verificar pasajeros hasta 15 minutos antes de la salida.'
        );
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(COALESCE(v_ride.passengers, '[]'::jsonb)) AS elem
        WHERE (
                v_target IS NULL
                OR elem->>'id' = v_target
                OR elem->>'user_id' = v_target
            )
          AND regexp_replace(COALESCE(elem->>'pin', elem->>'pin_code', ''), '\D', '', 'g') = v_pin
          AND lower(COALESCE(elem->>'status', '')) IN ('verified', 'on_board', 'completed')
    ) INTO v_already;

    IF v_already THEN
        RETURN jsonb_build_object('success', true, 'already_verified', true, 'message', 'El pasajero ya estaba verificado.');
    END IF;

    SELECT COUNT(*)
      INTO v_match_count
    FROM jsonb_array_elements(COALESCE(v_ride.passengers, '[]'::jsonb)) AS elem
    WHERE (
            v_target IS NULL
            OR elem->>'id' = v_target
            OR elem->>'user_id' = v_target
        )
      AND regexp_replace(COALESCE(elem->>'pin', elem->>'pin_code', ''), '\D', '', 'g') = v_pin
      AND lower(COALESCE(elem->>'status', '')) IN ('confirmed', 'accepted', 'pending_boarding');

    IF v_match_count = 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'PIN_INCORRECTO', 'message', 'PIN incorrecto o pasajero no encontrado');
    END IF;

    UPDATE public.rides r
    SET
        passengers = (
            SELECT jsonb_agg(
                CASE
                    WHEN (
                            v_target IS NULL
                            OR elem->>'id' = v_target
                            OR elem->>'user_id' = v_target
                        )
                         AND regexp_replace(COALESCE(elem->>'pin', elem->>'pin_code', ''), '\D', '', 'g') = v_pin
                         AND lower(COALESCE(elem->>'status', '')) IN ('confirmed', 'accepted', 'pending_boarding')
                    THEN elem || jsonb_build_object('status', 'verified', 'verified_at', NOW())
                    ELSE elem
                END
            )
            FROM jsonb_array_elements(COALESCE(r.passengers, '[]'::jsonb)) AS elem
        ),
        updated_at = NOW()
    WHERE r.id = p_ride_id;

    v_updated := FOUND;

    IF NOT v_updated THEN
        RETURN jsonb_build_object('success', false, 'error', 'PIN_INCORRECTO', 'message', 'PIN incorrecto o pasajero no encontrado');
    END IF;

    -- Do not flip the ride to active here. Starting is a separate, gated action.
    RETURN jsonb_build_object('success', true, 'message', 'Embarque confirmado correctamente');
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_verified_passengers_before_ride_start()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_unresolved_count integer := 0;
    v_unpaid_count integer := 0;
    v_unpaid_requests integer := 0;
BEGIN
    IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
        RETURN NEW;
    END IF;

    IF OLD.status = 'scheduled' AND NEW.status IN ('active', 'in_progress') THEN
        SELECT count(*)
          INTO v_unresolved_count
        FROM jsonb_array_elements(COALESCE(OLD.passengers, '[]'::jsonb)) AS passenger
        WHERE lower(COALESCE(passenger->>'status', '')) IN (
            'confirmed',
            'accepted',
            'pending_boarding'
        );

        SELECT count(*)
          INTO v_unpaid_count
        FROM jsonb_array_elements(COALESCE(OLD.passengers, '[]'::jsonb)) AS passenger
        WHERE lower(COALESCE(passenger->>'status', '')) IN (
            'pending',
            'requested',
            'awaiting_payment',
            'processing',
            'unpaid'
        )
           OR lower(COALESCE(passenger->>'payment_status', '')) IN (
            'unpaid',
            'pending',
            'failed',
            'requires_payment',
            'awaiting_payment',
            'processing',
            'incomplete'
        );

        SELECT count(*)
          INTO v_unpaid_requests
        FROM public.ride_requests rr
        WHERE rr.ride_id = OLD.id
          AND lower(COALESCE(rr.status, '')) IN (
            'pending',
            'requested',
            'awaiting_payment',
            'processing',
            'unpaid'
          );

        IF v_unpaid_count > 0 OR v_unpaid_requests > 0 THEN
            RAISE EXCEPTION USING
                ERRCODE = 'P0001',
                MESSAGE = 'PAYMENT_REQUIRED',
                DETAIL = format(
                    'Hay %s reserva(s) sin pagar. El viaje no puede iniciar hasta que se complete el pago o se cancele la reserva.',
                    v_unpaid_count + v_unpaid_requests
                );
        END IF;

        IF v_unresolved_count > 0 THEN
            RAISE EXCEPTION USING
                ERRCODE = 'P0001',
                MESSAGE = 'PIN_VERIFICATION_REQUIRED',
                DETAIL = format(
                    'Hay %s pasajero(s) confirmado(s) sin verificar. Verifica el PIN o resuelve el no-show antes de iniciar.',
                    v_unresolved_count
                ),
                HINT = 'Todos los pasajeros confirmados deben estar verified, completed, no_show o cancelled antes de iniciar.';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_require_verified_passengers_before_start ON public.rides;

CREATE TRIGGER trg_require_verified_passengers_before_start
BEFORE UPDATE OF status ON public.rides
FOR EACH ROW
EXECUTE FUNCTION public.enforce_verified_passengers_before_ride_start();

CREATE OR REPLACE FUNCTION public.get_ride_start_readiness(p_ride_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id uuid := auth.uid();
    v_ride public.rides%rowtype;
    v_unresolved jsonb := '[]'::jsonb;
    v_unpaid jsonb := '[]'::jsonb;
    v_verified_count integer := 0;
    v_unpaid_request_count integer := 0;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'AUTH_REQUIRED';
    END IF;

    SELECT *
      INTO v_ride
    FROM public.rides
    WHERE id = p_ride_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'RIDE_NOT_FOUND';
    END IF;

    IF v_ride.driver_id <> v_user_id THEN
        RAISE EXCEPTION 'DRIVER_ONLY';
    END IF;

    SELECT COALESCE(jsonb_agg(passenger), '[]'::jsonb)
      INTO v_unresolved
    FROM jsonb_array_elements(COALESCE(v_ride.passengers, '[]'::jsonb)) AS passenger
    WHERE lower(COALESCE(passenger->>'status', '')) IN (
        'confirmed',
        'accepted',
        'pending_boarding'
    );

    SELECT COALESCE(jsonb_agg(passenger), '[]'::jsonb)
      INTO v_unpaid
    FROM jsonb_array_elements(COALESCE(v_ride.passengers, '[]'::jsonb)) AS passenger
    WHERE lower(COALESCE(passenger->>'status', '')) IN (
        'pending',
        'requested',
        'awaiting_payment',
        'processing',
        'unpaid'
    )
       OR lower(COALESCE(passenger->>'payment_status', '')) IN (
        'unpaid',
        'pending',
        'failed',
        'requires_payment',
        'awaiting_payment',
        'processing',
        'incomplete'
    );

    SELECT count(*)
      INTO v_verified_count
    FROM jsonb_array_elements(COALESCE(v_ride.passengers, '[]'::jsonb)) AS passenger
    WHERE lower(COALESCE(passenger->>'status', '')) IN ('verified', 'completed', 'on_board');

    SELECT count(*)
      INTO v_unpaid_request_count
    FROM public.ride_requests rr
    WHERE rr.ride_id = v_ride.id
      AND lower(COALESCE(rr.status, '')) IN (
        'pending',
        'requested',
        'awaiting_payment',
        'processing',
        'unpaid'
      );

    RETURN jsonb_build_object(
        'ready',
            jsonb_array_length(v_unresolved) = 0
            AND jsonb_array_length(v_unpaid) = 0
            AND v_unpaid_request_count = 0,
        'ride_id', v_ride.id,
        'ride_status', v_ride.status,
        'unresolved_count', jsonb_array_length(v_unresolved),
        'unpaid_count', jsonb_array_length(v_unpaid),
        'unpaid_request_count', v_unpaid_request_count,
        'verified_count', v_verified_count,
        'unresolved_passengers', v_unresolved,
        'unpaid_passengers', v_unpaid
    );
END;
$$;

DROP FUNCTION IF EXISTS public.start_ride(uuid);
DROP FUNCTION IF EXISTS public.start_ride(uuid, uuid);

CREATE OR REPLACE FUNCTION public.start_ride(
    p_ride_id UUID,
    p_driver_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_ride public.rides%ROWTYPE;
    v_readiness JSONB;
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED', 'message', 'Debes iniciar sesión.');
    END IF;

    SELECT * INTO v_ride
    FROM public.rides
    WHERE id = p_ride_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'VIAJE_NO_ENCONTRADO', 'message', 'Viaje no encontrado');
    END IF;

    IF v_ride.driver_id IS DISTINCT FROM auth.uid()
       OR (p_driver_id IS NOT NULL AND v_ride.driver_id IS DISTINCT FROM p_driver_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'NO_AUTORIZADO', 'message', 'Solo el conductor puede iniciar el viaje.');
    END IF;

    IF v_ride.status IS DISTINCT FROM 'scheduled' THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'EL_VIAJE_YA_INICIO_O_TERMINO',
            'status', v_ride.status,
            'message', 'El viaje ya inició o terminó.'
        );
    END IF;

    IF v_ride.departure_time IS NOT NULL AND v_ride.departure_time > (NOW() + INTERVAL '15 minutes') THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'DEMASIADO_PRONTO',
            'message', 'Solo puedes iniciar el viaje 15 minutos antes de la hora de salida configurada.',
            'departure_time', v_ride.departure_time
        );
    END IF;

    v_readiness := public.get_ride_start_readiness(p_ride_id);
    IF COALESCE((v_readiness->>'ready')::boolean, false) IS NOT TRUE THEN
        IF COALESCE((v_readiness->>'unpaid_count')::int, 0) > 0
           OR COALESCE((v_readiness->>'unpaid_request_count')::int, 0) > 0 THEN
            RETURN jsonb_build_object(
                'success', false,
                'error', 'PAYMENT_REQUIRED',
                'message', 'Hay reservas sin pagar. El viaje no puede iniciar hasta que se complete el pago.',
                'readiness', v_readiness
            );
        END IF;

        RETURN jsonb_build_object(
            'success', false,
            'error', 'PIN_VERIFICATION_REQUIRED',
            'message', 'Debes verificar todos los PIN o resolver los no-show antes de iniciar.',
            'readiness', v_readiness
        );
    END IF;

    UPDATE public.rides
    SET status = 'active',
        started_at = COALESCE(started_at, NOW()),
        updated_at = NOW()
    WHERE id = p_ride_id
      AND status = 'scheduled';

    RETURN jsonb_build_object('success', true, 'message', 'Viaje iniciado correctamente', 'status', 'active');
END;
$$;

REVOKE ALL ON FUNCTION public.verify_passenger_boarding(uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_passenger_boarding(uuid, text, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.get_ride_start_readiness(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_ride_start_readiness(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.start_ride(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.start_ride(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.verify_passenger_boarding(uuid, text, uuid) IS
    'Marks a paid passenger as verified by PIN. Does not start the ride.';

COMMENT ON FUNCTION public.get_ride_start_readiness(uuid) IS
    'Driver-only readiness: no unpaid bookings and no unverified confirmed passengers.';

COMMENT ON FUNCTION public.start_ride(uuid, uuid) IS
    'Starts a scheduled ride only after payment and PIN/no-show resolution.';
