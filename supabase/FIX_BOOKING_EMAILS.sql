-- ============================================================================
-- SHAREWAY · FIX_BOOKING_EMAILS.sql
-- ============================================================================
-- Emails correctos al reservar:
--   · Al PASAJERO: "Has reservado X plazas" con viaje, importe y PIN de abordaje
--   · Al CONDUCTOR: "Tienes una nueva reserva" con datos del pasajero
-- Además arregla el email de "nuevo usuario" (campos undefined) y elimina el
-- trigger viejo con la service key de mentira (20260505).
--
-- Requiere que la Edge Function notify-admin-new-user esté actualizada con el
-- código nuevo del repo (soporta type=booking_confirmation / new_booking).
-- Es IDEMPOTENTE. Ejecutar entero en el SQL Editor.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_net;

-- ============================================================================
-- 1) Email de RESERVA (pasajero + conductor) al añadir pasajeros a un viaje
-- ============================================================================
CREATE OR REPLACE FUNCTION public.handle_booking_email_notification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_url TEXT := 'https://wmkhutsesgtkcgqbctef.supabase.co/functions/v1/notify-admin-new-user';
  v_headers JSONB := jsonb_build_object(
    'Content-Type', 'application/json',
    'x-sw-webhook', 'shareway-bookings-2026'
  );
  v_old_ids UUID[];
  v_pax JSONB;
  v_email TEXT;
  v_name TEXT;
  v_driver_email TEXT;
  v_driver_name TEXT;
  v_origin TEXT;
  v_destination TEXT;
  v_date TEXT;
  v_amount NUMERIC;
  v_seats INTEGER;
  v_pin TEXT;
BEGIN
  IF TG_OP <> 'UPDATE' THEN RETURN NEW; END IF;
  IF NEW.passengers IS NOT DISTINCT FROM OLD.passengers THEN RETURN NEW; END IF;

  -- ids de pasajeros que ya estaban antes
  SELECT COALESCE(array_agg(DISTINCT (e->>'id')::uuid), '{}')
    INTO v_old_ids
  FROM jsonb_array_elements(COALESCE(OLD.passengers, '[]'::jsonb)) e
  WHERE e->>'id' IS NOT NULL;

  v_origin := COALESCE(NEW.origin->>'name', NEW.origin->>'address', 'Origen');
  v_destination := COALESCE(NEW.destination->>'name', NEW.destination->>'address', 'Destino');
  v_date := COALESCE(to_char(NEW.departure_time AT TIME ZONE 'Europe/Madrid', 'DD/MM/YYYY a las HH24:MI'), '—');

  SELECT email, COALESCE(NULLIF(display_name, ''), COALESCE(full_name, 'Conductor'), 'Conductor')
    INTO v_driver_email, v_driver_name
  FROM public.profiles
  WHERE id = NEW.driver_id;

  FOR v_pax IN
    SELECT e
    FROM jsonb_array_elements(COALESCE(NEW.passengers, '[]'::jsonb)) e
  LOOP
    -- solo pasajeros NUEVOS en esta actualización
    IF v_pax->>'id' IS NULL THEN CONTINUE; END IF;
    IF (v_pax->>'id')::uuid = ANY(v_old_ids) THEN CONTINUE; END IF;
    IF lower(COALESCE(v_pax->>'status', 'confirmed')) IN
       ('cancelled', 'canceled', 'rejected', 'no_show') THEN CONTINUE; END IF;

    SELECT email, COALESCE(NULLIF(display_name, ''), COALESCE(full_name, 'Pasajero'), 'Pasajero')
      INTO v_email, v_name
    FROM public.profiles
    WHERE id = (v_pax->>'id')::uuid;

    v_seats := COALESCE((v_pax->>'seats')::int, 1);
    v_amount := COALESCE((v_pax->>'booked_price')::numeric, round(COALESCE(NEW.price,0) * v_seats, 2));
    v_pin := v_pax->>'pin';

    -- 1a. Email al PASAJERO (un fallo de email nunca bloquea la reserva)
    IF COALESCE(v_email, '') <> '' THEN
      BEGIN
        PERFORM net.http_post(
          url := v_url,
          headers := v_headers,
          body := jsonb_build_object(
            'type', 'booking_confirmation',
            'to_email', v_email,
            'to_name', v_name,
            'seats', v_seats,
            'amount', v_amount,
            'pin', v_pin,
            'origin', v_origin,
            'destination', v_destination,
            'departure_time', v_date
          )
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING '[booking_email] pasajero omitido: %', SQLERRM;
      END;
    END IF;

    -- 1b. Email al CONDUCTOR (si no es el mismo que el pasajero)
    IF COALESCE(v_driver_email, '') <> '' AND v_driver_email IS DISTINCT FROM v_email THEN
      BEGIN
        PERFORM net.http_post(
          url := v_url,
          headers := v_headers,
          body := jsonb_build_object(
            'type', 'new_booking',
            'to_email', v_driver_email,
            'to_name', v_driver_name,
            'passenger_name', v_name,
            'seats', v_seats,
            'amount', v_amount,
            'origin', v_origin,
            'destination', v_destination,
            'departure_time', v_date
          )
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING '[booking_email] conductor omitido: %', SQLERRM;
      END;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS tr_booking_email ON public.rides;
CREATE TRIGGER tr_booking_email
  AFTER UPDATE ON public.rides
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_booking_email_notification();

-- Eliminar el trigger viejo de 20260505 (usaba una service key falsa)
DROP TRIGGER IF EXISTS tr_ride_notifications ON public.rides;

-- ============================================================================
-- 2) Arreglar el email de NUEVO USUARIO (campos undefined)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.handle_new_user_notification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_url TEXT := 'https://wmkhutsesgtkcgqbctef.supabase.co/functions/v1/notify-admin-new-user';
  v_headers JSONB := jsonb_build_object(
    'Content-Type', 'application/json',
    'x-sw-webhook', 'shareway-bookings-2026'
  );
BEGIN
  PERFORM net.http_post(
    url := v_url,
    headers := v_headers,
    body := jsonb_build_object(
      'type', 'new_user',
      'name', COALESCE(NEW.display_name, NEW.full_name, 'Usuario'),
      'email', COALESCE(NEW.email, 'No proporcionado'),
      'user_id', NEW.id
    )
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[new_user_email] omitido: %', SQLERRM;
  RETURN NEW;
END;
$fn$;

NOTIFY pgrst, 'reload schema';
