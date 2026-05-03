-- ==============================================================================
-- 20260511_HARDEN_RIDE_LIFECYCLE_STATES.sql
-- Blindaje de Estados: Evita acciones en viajes Finalizados, Cancelados o Caducados.
-- Incluye protecciones para Embarque, Paradas, Liquidación, Chat y GPS.
-- ==============================================================================

-- 1. HARDENING: verify_passenger_boarding (Fusionado con restricción de 15 min)
CREATE OR REPLACE FUNCTION public.verify_passenger_boarding(
    p_ride_id UUID,
    p_pin TEXT,
    p_passenger_id UUID DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_updated BOOLEAN;
    v_ride_status TEXT;
    v_departure_time TIMESTAMPTZ;
BEGIN
    SELECT status, departure_time INTO v_ride_status, v_departure_time
    FROM public.rides WHERE id = p_ride_id;

    IF v_ride_status IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Viaje no encontrado');
    END IF;

    -- A. Bloqueo por estado
    IF v_ride_status NOT IN ('scheduled', 'active') THEN
        RETURN jsonb_build_object('success', false, 'message', 'El viaje no está en un estado que permita embarque (Estado: ' || v_ride_status || ')');
    END IF;

    -- B. Bloqueo por tiempo (Solo 15 min antes de la salida si está scheduled)
    IF v_ride_status = 'scheduled' AND v_departure_time > (NOW() + INTERVAL '15 minutes') THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'DEMASIADO_PRONTO',
            'message', 'No puedes verificar pasajeros hasta 15 minutos antes de la salida.'
        );
    END IF;

    -- Intentar actualizar el estado del pasajero
    UPDATE public.rides r
    SET
        passengers = (
            SELECT jsonb_agg(
                CASE
                    WHEN (elem->>'pin' = p_pin)
                         AND (p_passenger_id IS NULL OR (elem->>'id')::UUID = p_passenger_id)
                    THEN elem || jsonb_build_object('status', 'verified', 'verified_at', NOW())
                    ELSE elem
                END
            )
            FROM jsonb_array_elements(COALESCE(r.passengers, '[]'::jsonb)) AS elem
        ),
        updated_at = NOW()
    WHERE r.id = p_ride_id
      AND r.driver_id = auth.uid()
      AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(COALESCE(r.passengers, '[]'::jsonb)) AS check_elem
          WHERE check_elem->>'pin' = p_pin
            AND (p_passenger_id IS NULL OR (check_elem->>'id')::UUID = p_passenger_id)
      );

    v_updated := FOUND;

    IF v_updated THEN
        -- Si estaba programado, ahora pasa a activo
        UPDATE public.rides
        SET status = 'active',
            started_at = COALESCE(started_at, NOW())
        WHERE id = p_ride_id AND status = 'scheduled';

        RETURN jsonb_build_object('success', true, 'message', 'Embarque confirmado correctamente');
    ELSE
        RETURN jsonb_build_object('success', false, 'message', 'PIN incorrecto o pasajero no encontrado');
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. HARDENING: complete_passenger_dropoff
CREATE OR REPLACE FUNCTION public.complete_passenger_dropoff(
    p_ride_id UUID,
    p_passenger_id UUID
) RETURNS JSON AS $$
DECLARE
    v_ride_record RECORD;
    v_passenger JSONB;
    v_new_passengers JSONB := '[]'::JSONB;
    v_found BOOLEAN := FALSE;
    v_booked_price DECIMAL;
    v_payout_amount DECIMAL;
    v_platform_fee_percent DECIMAL := 0.10;
    v_driver_id UUID;
BEGIN
    -- Bloquear fila del viaje y verificar estado
    SELECT * INTO v_ride_record FROM public.rides WHERE id = p_ride_id FOR UPDATE;

    IF v_ride_record.id IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'Viaje no encontrado');
    END IF;

    IF v_ride_record.status != 'active' THEN
        RETURN json_build_object('success', false, 'error', 'Solo se pueden finalizar paradas en viajes activos (Estado actual: ' || v_ride_record.status || ')');
    END IF;

    v_driver_id := v_ride_record.driver_id;

    -- Recorrer pasajeros para encontrar al específico y actualizar su estado
    FOR v_passenger IN SELECT * FROM jsonb_array_elements(v_ride_record.passengers)
    LOOP
        IF (v_passenger->>'id')::UUID = p_passenger_id THEN
            IF v_passenger->>'status' != 'completed' THEN
                v_booked_price := (v_passenger->>'booked_price')::DECIMAL;
                v_payout_amount := v_booked_price * (1 - v_platform_fee_percent);

                UPDATE public.wallets
                SET held_balance = GREATEST(0, COALESCE(held_balance, 0) - v_booked_price),
                    updated_at = NOW()
                WHERE user_id = p_passenger_id;

                UPDATE public.wallets
                SET balance = COALESCE(balance, 0) + v_payout_amount,
                    updated_at = NOW()
                WHERE user_id = v_driver_id;

                INSERT INTO public.transactions (user_id, amount, type, description, related_ride_id)
                VALUES (p_passenger_id, -v_booked_price, 'payment_complete', 'Pago realizado: Llegada a destino', p_ride_id);

                INSERT INTO public.transactions (user_id, amount, type, description, related_ride_id)
                VALUES (v_driver_id, v_payout_amount, 'payout', 'Ingreso: Pasajero entregado', p_ride_id);

                v_passenger := v_passenger || jsonb_build_object('status', 'completed', 'completed_at', NOW());
                v_found := TRUE;
            END IF;
        END IF;
        v_new_passengers := v_new_passengers || v_passenger;
    END LOOP;

    IF v_found THEN
        UPDATE public.rides SET passengers = v_new_passengers, updated_at = NOW() WHERE id = p_ride_id;

        -- Si todos los pasajeros están 'completed' o 'cancelled', cerrar el viaje
        IF NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements(v_new_passengers) AS p
            WHERE p->>'status' NOT IN ('completed', 'cancelled')
        ) THEN
            UPDATE public.rides SET status = 'completed', completed_at = NOW() WHERE id = p_ride_id;
        END IF;

        RETURN json_build_object('success', true, 'message', 'Pasajero entregado y pago liberado');
    ELSE
        RETURN json_build_object('success', false, 'error', 'Pasajero no encontrado o ya procesado');
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. HARDENING: complete_ride
CREATE OR REPLACE FUNCTION public.complete_ride(p_ride_id UUID)
RETURNS JSONB AS $$
DECLARE
    v_driver_id UUID := auth.uid();
    v_passenger RECORD;
    v_total_payout NUMERIC := 0;
    v_platform_fee_total NUMERIC := 0;
    v_ride_status TEXT;
BEGIN
    SELECT status INTO v_ride_status FROM public.rides
    WHERE id = p_ride_id AND driver_id = v_driver_id FOR UPDATE;

    IF v_ride_status IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Viaje no encontrado o no eres el conductor');
    END IF;

    -- Solo permitir si está activo o programado
    IF v_ride_status NOT IN ('active', 'scheduled') THEN
        RETURN jsonb_build_object('success', false, 'error', 'El viaje ya no puede ser liquidado (Estado: ' || v_ride_status || ')');
    END IF;

    FOR v_passenger IN
        SELECT (p->>'id')::UUID as id,
               COALESCE((p->>'booked_price')::NUMERIC, 0) as price,
               COALESCE((p->>'seats_booked')::INTEGER, (p->>'num_seats')::INTEGER, 1) as seats,
               (p->>'status') as status
        FROM public.rides r, jsonb_array_elements(r.passengers) p
        WHERE r.id = p_ride_id
    LOOP
        DECLARE
            v_subtotal NUMERIC := v_passenger.price * v_passenger.seats;
        BEGIN
            IF v_passenger.status = 'verified' THEN
                DECLARE
                    v_net_payout NUMERIC := v_subtotal * 0.90;
                    v_fee NUMERIC := v_subtotal * 0.10;
                BEGIN
                    UPDATE public.wallets
                    SET balance = COALESCE(balance, 0.00) + v_net_payout,
                        updated_at = NOW()
                    WHERE user_id = v_driver_id;

                    UPDATE public.wallets
                    SET held_balance = GREATEST(0, COALESCE(held_balance, 0.00) - v_subtotal),
                        updated_at = NOW()
                    WHERE user_id = v_passenger.id;

                    INSERT INTO public.transactions (user_id, amount, type, related_ride_id, description)
                    VALUES (v_driver_id, v_net_payout, 'earning', p_ride_id, 'Ingreso por viaje finalizado');

                    v_total_payout := v_total_payout + v_net_payout;
                    v_platform_fee_total := v_platform_fee_total + v_fee;
                END;
            ELSIF v_passenger.status = 'confirmed' THEN
                -- DEVOLUCIÓN: Si el pasajero no subió (no verificado), liberamos su dinero
                UPDATE public.wallets
                SET balance = COALESCE(balance, 0.00) + v_subtotal,
                    held_balance = GREATEST(0, COALESCE(held_balance, 0.00) - v_subtotal),
                    updated_at = NOW()
                WHERE user_id = v_passenger.id;

                INSERT INTO public.transactions (user_id, amount, type, related_ride_id, description)
                VALUES (v_passenger.id, v_subtotal, 'refund', p_ride_id, 'Devolución: Viaje finalizado sin embarque');
            END IF;
        END;
    END LOOP;

    UPDATE public.rides
    SET status = 'completed',
        updated_at = NOW(),
        completed_at = NOW()
    WHERE id = p_ride_id;

    RETURN jsonb_build_object(
        'success', true,
        'payout', v_total_payout,
        'fee', v_platform_fee_total,
        'message', 'Viaje finalizado correctamente'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. HARDENING: update_ride_location (GPS)
CREATE OR REPLACE FUNCTION public.update_ride_location(
    p_ride_id UUID,
    p_lat DOUBLE PRECISION,
    p_lng DOUBLE PRECISION,
    p_heading DOUBLE PRECISION DEFAULT 0
) RETURNS VOID AS $$
BEGIN
    -- Solo permitir tracking si el viaje está activo (o programado para el "camino al inicio")
    IF NOT EXISTS (
        SELECT 1 FROM public.rides
        WHERE id = p_ride_id
          AND driver_id = auth.uid()
          AND status IN ('active', 'scheduled')
    ) THEN
        RETURN;
    END IF;

    INSERT INTO public.ride_locations (ride_id, latitude, longitude, heading, updated_at)
    VALUES (p_ride_id, p_lat, p_lng, p_heading, NOW())
    ON CONFLICT (ride_id) DO UPDATE SET
        latitude = EXCLUDED.latitude,
        longitude = EXCLUDED.longitude,
        heading = EXCLUDED.heading,
        updated_at = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. CHAT HARDENING: RLS Policy for messages
-- Bloquear envío de nuevos mensajes si el viaje ya terminó
DROP POLICY IF EXISTS "Users can send messages to their chats" ON public.messages;
CREATE POLICY "Users can send messages to their chats"
ON public.messages
FOR INSERT
WITH CHECK (
    sender_id = auth.uid() AND
    EXISTS (
        SELECT 1 FROM public.chats c
        LEFT JOIN public.rides r ON c.ride_id = r.id
        WHERE c.id = messages.chat_id
        AND auth.uid() = ANY(c.participants)
        -- Permitir si no hay viaje (chat directo) o si el viaje sigue vigente
        AND (c.ride_id IS NULL OR r.status IN ('scheduled', 'active'))
    )
);

-- 6. INDEX para optimizar la política de Chat
CREATE INDEX IF NOT EXISTS idx_chats_ride_id ON public.chats(ride_id);

-- 7. REVISIÓN DE cancel_ride_unified
CREATE OR REPLACE FUNCTION public.cancel_ride_unified(p_ride_id UUID, p_reason TEXT DEFAULT 'Cancelación operativa')
RETURNS JSONB AS $$
DECLARE
    v_ride_record RECORD;
    v_passenger JSONB;
    v_passenger_id UUID;
    v_booked_price NUMERIC;
    v_p_id_str TEXT;
BEGIN
    SELECT * INTO v_ride_record FROM public.rides WHERE id = p_ride_id FOR UPDATE;

    IF v_ride_record.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Viaje no encontrado');
    END IF;

    -- Solo permitir cancelar si no ha terminado/expirado
    IF v_ride_record.status NOT IN ('scheduled', 'active') THEN
        RETURN jsonb_build_object('success', false, 'message', 'No se puede cancelar un viaje que ya está ' || v_ride_record.status);
    END IF;

    IF v_ride_record.passengers IS NOT NULL THEN
        FOR v_passenger IN SELECT * FROM jsonb_array_elements(v_ride_record.passengers) LOOP
            v_p_id_str := COALESCE(v_passenger->>'id', v_passenger->>'user_id');

            IF v_p_id_str ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
                v_passenger_id := v_p_id_str::UUID;
                v_booked_price := COALESCE((v_passenger->>'booked_price')::NUMERIC, 0);

                IF v_passenger->>'status' IN ('confirmed', 'verified') AND v_passenger_id IS NOT NULL THEN
                    UPDATE public.wallets
                    SET held_balance = GREATEST(0, held_balance - v_booked_price),
                        balance = balance + v_booked_price,
                        updated_at = NOW()
                    WHERE user_id = v_passenger_id;

                    INSERT INTO public.transactions (user_id, amount, type, description, related_ride_id)
                    VALUES (v_passenger_id, v_booked_price, 'refund', 'Reembolso por cancelación: ' || p_reason, p_ride_id);

                    PERFORM public.create_notification(
                        v_passenger_id,
                        'ride_cancelled',
                        'Viaje Cancelado',
                        'El conductor ha cancelado el viaje. Se ha devuelto tu dinero.',
                        jsonb_build_object('ride_id', p_ride_id)
                    );
                END IF;
            END IF;
        END LOOP;
    END IF;

    UPDATE public.rides SET status = 'cancelled', updated_at = NOW() WHERE id = p_ride_id;
    RETURN jsonb_build_object('success', true, 'message', 'Viaje cancelado correctamente');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
