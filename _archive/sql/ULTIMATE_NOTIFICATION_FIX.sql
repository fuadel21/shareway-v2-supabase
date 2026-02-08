-- ==========================================
-- ULTIMATE FIX: NOTIFICATIONS SYSTEM V16 (ENUM EXPANSION)
-- ==========================================
-- This script adds missing values to the transaction enums safely.
-- It fixes "invalid input value for enum transaction_type: 'trip_payment'".
-- 1. SAFE ENUM EXPANSION (Must be outside DO blocks)
ALTER TYPE public.transaction_type
ADD VALUE IF NOT EXISTS 'trip_payment';
ALTER TYPE public.transaction_type
ADD VALUE IF NOT EXISTS 'trip_earning';
-- 2. NUCLEAR CLEANUP (ALL SCHEMAS)
DO $$
DECLARE r RECORD;
BEGIN FOR r IN (
    SELECT n.nspname as schema_name,
        p.proname as function_name,
        p.oid::regprocedure as sig
    FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE p.proname IN (
            'create_notification',
            'start_ride',
            'complete_ride',
            'credit_wallet_on_success'
        )
) LOOP EXECUTE 'DROP FUNCTION ' || r.sig || ' CASCADE';
END LOOP;
END $$;
-- 3. SCHEMA FREEDOM & ATOMIC REPAIR
DO $$ BEGIN -- A. Remove all restrictive check constraints on Notifications
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_priority_check;
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_status_check;
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_category_check;
-- B. Attempt TEXT conversion only for wallet_transactions
BEGIN IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'wallet_transactions'
        AND column_name = 'type'
) THEN
ALTER TABLE public.wallet_transactions
ALTER COLUMN type TYPE TEXT;
END IF;
EXCEPTION
WHEN OTHERS THEN RAISE NOTICE 'Could not convert wallet_transactions.type to TEXT, relying on Enum expansion.';
END;
-- C. Ensure Notification columns exist
ALTER TABLE public.notifications
ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE public.notifications
ADD COLUMN IF NOT EXISTS message TEXT;
ALTER TABLE public.notifications
ADD COLUMN IF NOT EXISTS content TEXT;
ALTER TABLE public.notifications
ADD COLUMN IF NOT EXISTS body TEXT;
ALTER TABLE public.notifications
ADD COLUMN IF NOT EXISTS type TEXT;
ALTER TABLE public.notifications
ADD COLUMN IF NOT EXISTS data JSONB;
ALTER TABLE public.notifications
ADD COLUMN IF NOT EXISTS payload JSONB;
ALTER TABLE public.notifications
ADD COLUMN IF NOT EXISTS status TEXT;
ALTER TABLE public.notifications
ADD COLUMN IF NOT EXISTS priority TEXT;
ALTER TABLE public.notifications
ADD COLUMN IF NOT EXISTS category TEXT;
-- D. Sanitization
UPDATE public.notifications
SET title = COALESCE(title, 'Notificación'),
    message = COALESCE(message, ''),
    content = COALESCE(content, ''),
    body = COALESCE(body, ''),
    type = COALESCE(type, 'info'),
    data = COALESCE(data, '{}'::jsonb),
    payload = COALESCE(payload, '{}'::jsonb),
    status = COALESCE(status, 'pending'),
    priority = COALESCE(priority, '1'),
    category = COALESCE(category, 'general');
-- E. Defaults
ALTER TABLE public.notifications
ALTER COLUMN title
SET DEFAULT 'Notificación',
    ALTER COLUMN title
SET NOT NULL;
ALTER TABLE public.notifications
ALTER COLUMN message
SET DEFAULT '',
    ALTER COLUMN message
SET NOT NULL;
ALTER TABLE public.notifications
ALTER COLUMN content
SET DEFAULT '',
    ALTER COLUMN content
SET NOT NULL;
ALTER TABLE public.notifications
ALTER COLUMN body
SET DEFAULT '',
    ALTER COLUMN body
SET NOT NULL;
ALTER TABLE public.notifications
ALTER COLUMN type
SET DEFAULT 'info',
    ALTER COLUMN type
SET NOT NULL;
ALTER TABLE public.notifications
ALTER COLUMN data
SET DEFAULT '{}'::jsonb,
    ALTER COLUMN data
SET NOT NULL;
ALTER TABLE public.notifications
ALTER COLUMN payload
SET DEFAULT '{}'::jsonb,
    ALTER COLUMN payload
SET NOT NULL;
ALTER TABLE public.notifications
ALTER COLUMN status
SET DEFAULT 'pending',
    ALTER COLUMN status
SET NOT NULL;
END $$;
-- 4. create_notification
CREATE OR REPLACE FUNCTION public.create_notification(
        p_user_id UUID,
        p_title TEXT DEFAULT 'Notificación',
        p_message TEXT DEFAULT '',
        p_content TEXT DEFAULT NULL,
        p_body TEXT DEFAULT NULL,
        p_type TEXT DEFAULT 'info',
        p_data JSONB DEFAULT '{}'::jsonb,
        p_metadata JSONB DEFAULT '{}'::jsonb,
        p_ride_id TEXT DEFAULT NULL,
        p_priority TEXT DEFAULT '1',
        p_category TEXT DEFAULT 'general',
        p_scheduled_at TIMESTAMPTZ DEFAULT NOW(),
        p_expires_days INTEGER DEFAULT 30
    ) RETURNS JSON AS $$
DECLARE v_id BIGINT;
v_msg TEXT;
v_dat JSONB;
BEGIN v_msg := COALESCE(p_message, p_content, p_body, '');
v_dat := COALESCE(p_data, '{}'::jsonb) || COALESCE(p_metadata, '{}'::jsonb);
IF p_ride_id IS NOT NULL THEN v_dat := v_dat || jsonb_build_object('ride_id', p_ride_id);
END IF;
INSERT INTO public.notifications (
        user_id,
        title,
        message,
        content,
        body,
        type,
        data,
        payload,
        status,
        read,
        is_read,
        priority,
        category
    )
VALUES (
        p_user_id,
        COALESCE(p_title, 'Notificación'),
        v_msg,
        v_msg,
        v_msg,
        COALESCE(p_type, 'info'),
        v_dat,
        jsonb_build_object(
            'title',
            p_title,
            'message',
            v_msg,
            'type',
            p_type,
            'data',
            v_dat
        ),
        'pending',
        FALSE,
        FALSE,
        COALESCE(p_priority, '1'),
        COALESCE(p_category, 'general')
    )
RETURNING id INTO v_id;
RETURN json_build_object('success', true, 'id', v_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 5. overloads
CREATE OR REPLACE FUNCTION public.create_notification(
        arg1 UUID,
        arg2 TEXT,
        arg3 TEXT,
        arg4 TEXT,
        arg5 JSON,
        arg6 INTEGER
    ) RETURNS JSON AS $$ BEGIN RETURN public.create_notification(
        p_user_id := arg1,
        p_title := arg2,
        p_message := arg3,
        p_type := arg4,
        p_data := arg5::JSONB,
        p_priority := arg6::TEXT
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 6. start_ride
CREATE OR REPLACE FUNCTION public.start_ride(p_ride_id UUID) RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE v_driver_id UUID := auth.uid();
v_pid UUID;
BEGIN
UPDATE public.rides
SET status = 'in_progress',
    started_at = NOW()
WHERE id = p_ride_id
    AND driver_id = v_driver_id;
IF NOT FOUND THEN RAISE EXCEPTION 'No se pudo iniciar el viaje.';
END IF;
FOR v_pid IN
SELECT unnest(participant_ids)
FROM public.rides
WHERE id = p_ride_id LOOP IF v_pid != v_driver_id THEN PERFORM public.create_notification(
        v_pid,
        '¡Viaje iniciado!',
        'Tu conductor ha comenzado el trayecto.',
        'info',
        '{}'::JSONB
    );
END IF;
END LOOP;
RETURN json_build_object('success', true);
END;
$$;
-- 7. complete_ride
CREATE OR REPLACE FUNCTION public.complete_ride(p_ride_id UUID) RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE v_driver_id UUID;
v_ride_driver UUID;
v_passengers JSONB;
v_new_passenger_state JSONB;
v_passenger RECORD;
v_passenger_id UUID;
v_booked_price DECIMAL;
v_platform_fee DECIMAL;
v_driver_earning DECIMAL;
v_co2_saved DECIMAL;
v_distance DECIMAL;
v_passenger_count INTEGER;
v_pass_list JSONB := '[]'::JSONB;
v_dep_time TIMESTAMPTZ;
BEGIN v_driver_id := auth.uid();
IF v_driver_id IS NULL THEN RAISE EXCEPTION 'No autenticado';
END IF;
SELECT driver_id,
    passengers,
    distance,
    departure_time INTO v_ride_driver,
    v_passengers,
    v_distance,
    v_dep_time
FROM public.rides
WHERE id = p_ride_id FOR
UPDATE;
IF v_ride_driver IS NULL THEN RAISE EXCEPTION 'El viaje no existe';
END IF;
IF v_ride_driver != v_driver_id THEN RAISE EXCEPTION 'Solo el conductor puede completar el viaje';
END IF;
IF NOW() < v_dep_time THEN RAISE EXCEPTION 'No puedes completar un viaje antes de su hora de salida';
END IF;
v_passenger_count := jsonb_array_length(v_passengers);
v_co2_saved := CASE
    WHEN v_distance > 0
    AND v_passenger_count > 0 THEN (v_distance * 0.12) * v_passenger_count
    ELSE 0
END;
FOR v_passenger IN
SELECT *
FROM jsonb_array_elements(v_passengers) LOOP v_new_passenger_state := v_passenger.value;
IF (v_passenger.value->>'status') IN ('confirmed', 'verified', 'confirmed_by_pin') THEN v_passenger_id := (v_passenger.value->>'id')::UUID;
v_booked_price := (v_passenger.value->>'booked_price')::DECIMAL;
v_platform_fee := ROUND(v_booked_price * 0.15, 2);
v_driver_earning := v_booked_price - v_platform_fee;
UPDATE public.wallets
SET held_balance = held_balance - v_booked_price
WHERE user_id = v_passenger_id;
INSERT INTO public.wallet_transactions (
        wallet_id,
        user_id,
        type,
        amount,
        balance_after,
        description,
        related_ride_id
    )
SELECT user_id,
    user_id,
    'trip_payment',
    - v_booked_price,
    balance,
    'Pago final viaje',
    p_ride_id
FROM public.wallets
WHERE user_id = v_passenger_id;
UPDATE public.wallets
SET balance = balance + v_driver_earning
WHERE user_id = v_driver_id;
INSERT INTO public.wallet_transactions (
        wallet_id,
        user_id,
        type,
        amount,
        balance_after,
        description,
        related_ride_id
    )
SELECT user_id,
    user_id,
    'trip_earning',
    v_driver_earning,
    balance,
    'Ganancia por viaje completado',
    p_ride_id
FROM public.wallets
WHERE user_id = v_driver_id;
v_new_passenger_state := jsonb_set(v_new_passenger_state, '{status}', '"completed"');
END IF;
v_pass_list := v_pass_list || v_new_passenger_state;
END LOOP;
UPDATE public.rides
SET status = 'completed',
    passengers = v_pass_list,
    co2_saved = v_co2_saved
WHERE id = p_ride_id;
RETURN json_build_object(
    'success',
    true,
    'message',
    'Viaje completado',
    'co2_saved',
    v_co2_saved
);
END;
$$;
-- 8. credit_wallet_on_success
CREATE OR REPLACE FUNCTION public.credit_wallet_on_success(p_payment_intent_id TEXT, p_amount DECIMAL) RETURNS JSON AS $$
DECLARE v_user_id UUID := auth.uid();
v_current_balance DECIMAL;
BEGIN IF v_user_id IS NULL THEN RAISE EXCEPTION 'No autenticado';
END IF;
IF p_amount <= 0 THEN RAISE EXCEPTION 'Monto inválido';
END IF;
IF EXISTS (
    SELECT 1
    FROM public.wallet_transactions
    WHERE description LIKE '%' || p_payment_intent_id || '%'
) THEN RETURN json_build_object('success', true, 'message', 'Pago ya procesado.');
END IF;
INSERT INTO public.wallets (user_id, balance, held_balance, updated_at)
VALUES (v_user_id, p_amount, 0, NOW()) ON CONFLICT (user_id) DO
UPDATE
SET balance = public.wallets.balance + EXCLUDED.balance,
    updated_at = NOW()
RETURNING balance INTO v_current_balance;
INSERT INTO public.wallet_transactions (
        user_id,
        wallet_id,
        amount,
        balance_after,
        type,
        description
    )
VALUES (
        v_user_id,
        v_user_id,
        p_amount,
        v_current_balance,
        'deposit_stripe',
        'Recarga vía Stripe: ' || p_payment_intent_id
    );
RETURN json_build_object(
    'success',
    true,
    'new_balance',
    v_current_balance
);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 9. PERMISSIONS & RELOAD
DO $$
DECLARE r RECORD;
BEGIN FOR r IN (
    SELECT oid::regprocedure as sig
    FROM pg_proc
    WHERE proname IN (
            'create_notification',
            'start_ride',
            'complete_ride',
            'credit_wallet_on_success'
        )
) LOOP EXECUTE 'GRANT EXECUTE ON FUNCTION ' || r.sig || ' TO authenticated, anon, service_role';
END LOOP;
END $$;
NOTIFY pgrst,
'reload schema';