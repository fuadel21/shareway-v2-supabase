-- ============================================================================
-- SHAREWAY · FIX_SUBMIT_REVIEW_GUARDS.sql
-- ============================================================================
-- El submit_review_v2 de produccion era un INSERT directo SIN validaciones:
--   · permitia valoraciones duplicadas del mismo usuario al mismo viaje
--   · permitia auto-valoracion (el cliente lo bloquea, el RPC no)
--   · permitia valorar viajes no completados o viajes ajenos
-- Version blindada con todas las reglas y reputacion actualizada.
-- Es IDEMPOTENTE.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.submit_review_v2(
  p_ride_id UUID,
  p_reviewee_id UUID,
  p_rating INTEGER,
  p_comment TEXT DEFAULT ''
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_reviewer UUID := auth.uid();
  v_ride public.rides%ROWTYPE;
  v_is_driver BOOLEAN;
  v_is_passenger BOOLEAN;
  v_reviewee_is_driver BOOLEAN;
  v_reviewee_is_passenger BOOLEAN;
  v_review_id UUID;
BEGIN
  IF v_reviewer IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  END IF;

  IF p_rating IS NULL OR p_rating < 1 OR p_rating > 5 THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_RATING');
  END IF;

  IF p_reviewee_id IS NULL OR p_reviewee_id = v_reviewer THEN
    RETURN jsonb_build_object('success', false, 'error', 'SELF_REVIEW_NOT_ALLOWED');
  END IF;

  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id;
  IF v_ride.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'RIDE_NOT_FOUND');
  END IF;

  IF lower(COALESCE(v_ride.status, '')) <> 'completed' THEN
    RETURN jsonb_build_object('success', false, 'error', 'RIDE_NOT_COMPLETED');
  END IF;

  -- El revisor debe ser el conductor o un pasajero activo del viaje
  v_is_driver := v_ride.driver_id = v_reviewer;
  v_is_passenger := EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(v_ride.passengers, '[]'::JSONB)) p
    WHERE (p->>'id')::UUID = v_reviewer
      AND lower(COALESCE(p->>'status', '')) NOT IN
          ('cancelled', 'canceled', 'rejected', 'no_show')
  );

  IF NOT (v_is_driver OR v_is_passenger) THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_A_PARTICIPANT');
  END IF;

  -- El valorado debe ser contraparte del mismo viaje
  v_reviewee_is_driver := v_ride.driver_id = p_reviewee_id;
  v_reviewee_is_passenger := EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(v_ride.passengers, '[]'::JSONB)) p
    WHERE (p->>'id')::UUID = p_reviewee_id
      AND lower(COALESCE(p->>'status', '')) NOT IN
          ('cancelled', 'canceled', 'rejected', 'no_show')
  );

  IF NOT (v_reviewee_is_driver OR v_reviewee_is_passenger) THEN
    RETURN jsonb_build_object('success', false, 'error', 'REVIEWEE_NOT_IN_RIDE');
  END IF;

  -- Una valoracion por viaje+revisor+valorado (puedes valorar al conductor
  -- y tambien a un companero del mismo viaje, pero no dos veces a la misma persona)
  IF EXISTS (SELECT 1 FROM public.reviews WHERE ride_id = p_ride_id AND reviewer_id = v_reviewer AND reviewee_id = p_reviewee_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'ALREADY_REVIEWED');
  END IF;

  INSERT INTO public.reviews (ride_id, reviewer_id, reviewee_id, rating, comment)
  VALUES (p_ride_id, v_reviewer, p_reviewee_id, p_rating, left(TRIM(COALESCE(p_comment, '')), 1000))
  RETURNING id INTO v_review_id;

  UPDATE public.profiles
  SET rating = (SELECT round(AVG(rating)::numeric, 2) FROM public.reviews WHERE reviewee_id = p_reviewee_id),
      review_count = (SELECT count(*) FROM public.reviews WHERE reviewee_id = p_reviewee_id)
  WHERE id = p_reviewee_id;

  -- Notificar al valorado (best-effort)
  BEGIN
    PERFORM public.create_notification(
      p_reviewee_id, 'new_review', 'Nueva valoración',
      'Has recibido ' || p_rating || ' estrellas.',
      jsonb_build_object('ride_id', p_ride_id, 'rating', p_rating)
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[submit_review_v2] notif omitida: %', SQLERRM;
  END;

  RETURN jsonb_build_object('success', true, 'review_id', v_review_id);
END;
$fn$;

REVOKE ALL ON FUNCTION public.submit_review_v2(UUID, UUID, INTEGER, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_review_v2(UUID, UUID, INTEGER, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.submit_review_v2(UUID, UUID, INTEGER, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_review_v2(UUID, UUID, INTEGER, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';
