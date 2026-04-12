-- ========================================================
-- SANEAMIENTO TOTAL Y BLINDAJE DE LÓGICA V3
-- Limpieza de funciones duplicadas y corrección de reembolsos
-- ========================================================

-- 1. Limpiar funciones conflictivas antes de recrearlas
DROP FUNCTION IF EXISTS public.cancel_ride(uuid);
DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;

-- 2. Corregir el Trigger de Nuevo Usuario (Asegurar Wallet y Perfil)
CREATE OR REPLACE FUNCTION public.handle_new_user() 
RETURNS TRIGGER AS $$ 
BEGIN
    INSERT INTO public.profiles (id, email, display_name, photo_url, is_verified)
    VALUES (
        new.id, 
        new.email, 
        split_part(new.email, '@', 1), 
        'https://api.dicebear.com/7.x/avataaars/svg?seed=' || new.id,
        FALSE
    );

    INSERT INTO public.wallets (user_id, balance, held_balance)
    VALUES (new.id, 0.00, 0.00);

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users 
FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- 3. Función Unificada para Cancelar Viaje (Conductor) con Reembolso Total
CREATE OR REPLACE FUNCTION public.cancel_ride(p_ride_id UUID)
RETURNS JSON AS $$
DECLARE
    v_driver_id UUID := auth.uid();
    v_passenger RECORD;
    v_ride_record RECORD;
BEGIN
    SELECT * INTO v_ride_record FROM public.rides WHERE id = p_ride_id FOR UPDATE;

    IF v_ride_record.driver_id != v_driver_id THEN
        RAISE EXCEPTION 'No autorizado';
    END IF;

    IF v_ride_record.status IN ('completed', 'cancelled') THEN
        RAISE EXCEPTION 'El viaje ya está finalizado o cancelado';
    END IF;

    -- REEMBOLSAR A TODOS LOS PASAJEROS
    FOR v_passenger IN SELECT * FROM jsonb_array_elements(v_ride_record.passengers) LOOP
        -- Devolver de held a balance
        UPDATE public.wallets
        SET 
            balance = balance + (v_passenger.value->>'booked_price')::DECIMAL,
            held_balance = held_balance - (v_passenger.value->>'booked_price')::DECIMAL,
            updated_at = NOW()
        WHERE user_id = (v_passenger.value->>'id')::UUID;

        -- Registrar transacción de devolución
        INSERT INTO public.transactions (user_id, amount, type, description, related_ride_id)
        VALUES ((v_passenger.value->>'id')::UUID, (v_passenger.value->>'booked_price')::DECIMAL, 'refund', 'Reembolso por cancelación del conductor', p_ride_id);
    END LOOP;

    -- Actualizar estado del viaje
    UPDATE public.rides
    SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
    WHERE id = p_ride_id;

    RETURN json_build_object('success', true, 'message', 'Viaje cancelado y pasajeros reembolsados');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Función de obtención de detalles (Garantizar consistencia)
CREATE OR REPLACE FUNCTION public.get_ride_details_secure(p_ride_id UUID)
RETURNS JSON AS $$
DECLARE
    v_result JSON;
BEGIN
    SELECT json_build_object(
        'id', r.id,
        'driver_id', r.driver_id,
        'driver_name', p.display_name,
        'driver_photo', p.photo_url,
        'driver_verified', p.is_verified,
        'driver_rating', p.rating,
        'origin', r.origin,
        'destination', r.destination,
        'departure_time', r.departure_time,
        'seats_total', r.seats_total,
        'seats_available', r.seats_available,
        'price', r.price,
        'status', r.status,
        'passengers', r.passengers,
        'is_women_only', r.is_women_only,
        'overview_polyline', r.overview_polyline
    ) INTO v_result
    FROM public.rides r
    JOIN public.profiles p ON r.driver_id = p.id
    WHERE r.id = p_ride_id;

    RETURN v_result;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
