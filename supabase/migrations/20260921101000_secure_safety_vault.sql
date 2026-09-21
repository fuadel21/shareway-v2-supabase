-- ============================================================================
-- ShareWay safety evidence vault
--
-- The client may upload evidence for a ride in which the authenticated user is
-- a participant, but the bucket is private and only admins/security operators
-- can read, update, or delete the stored object. This migration does not claim
-- browser-side encryption: Supabase Storage remains private and encrypted at
-- rest according to the project's Storage deployment.
-- ============================================================================

-- Keep the metadata table private as well. Existing clients only need to add
-- their own evidence and see their own evidence identifiers when filing a
-- dispute; the actual audio object is not exposed to the user.
ALTER TABLE public.safety_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.safety_evidence FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own safety evidence" ON public.safety_evidence;
DROP POLICY IF EXISTS "Users can insert their own safety evidence" ON public.safety_evidence;
DROP POLICY IF EXISTS safety_evidence_select_owner_or_admin ON public.safety_evidence;
DROP POLICY IF EXISTS safety_evidence_insert_related ON public.safety_evidence;
DROP POLICY IF EXISTS safety_evidence_admin_manage ON public.safety_evidence;

CREATE POLICY safety_evidence_select_owner_or_admin
ON public.safety_evidence
FOR SELECT
TO authenticated
USING (
    user_id = auth.uid()
    OR public.is_current_user_admin()
);

CREATE POLICY safety_evidence_insert_related
ON public.safety_evidence
FOR INSERT
TO authenticated
WITH CHECK (
    user_id = auth.uid()
    AND (
        ride_id IS NULL
        OR EXISTS (
            SELECT 1
            FROM public.rides AS r
            WHERE r.id = safety_evidence.ride_id
              AND (
                  r.driver_id = auth.uid()
                  OR (
                      auth.uid() = ANY(COALESCE(r.participant_ids, ARRAY[]::UUID[]))
                      AND NOT EXISTS (
                          SELECT 1
                          FROM jsonb_array_elements(COALESCE(r.passengers, '[]'::JSONB)) AS cancelled_participant(value)
                          WHERE lower(COALESCE(
                              cancelled_participant.value ->> 'id',
                              cancelled_participant.value ->> 'passenger_id',
                              cancelled_participant.value ->> 'user_id',
                              ''
                          )) = lower(auth.uid()::TEXT)
                            AND lower(COALESCE(cancelled_participant.value ->> 'status', '')) IN ('cancelled', 'canceled')
                      )
                  )
                  OR EXISTS (
                      SELECT 1
                      FROM jsonb_array_elements(COALESCE(r.passengers, '[]'::JSONB)) AS passenger(value)
                      WHERE lower(COALESCE(
                          passenger.value ->> 'id',
                          passenger.value ->> 'passenger_id',
                          passenger.value ->> 'user_id',
                          ''
                      )) = lower(auth.uid()::TEXT)
                        AND lower(COALESCE(passenger.value ->> 'status', '')) NOT IN ('cancelled', 'canceled')
                  )
              )
        )
    )
    AND (
        file_path IS NULL
        OR file_path ~ (
            '^blackbox/' || ride_id::TEXT || '/[^/]+\.(webm|ogg|mp4|m4a|wav)$'
        )
    )
);

-- Security operators can reconcile metadata and remove evidence through the
-- authenticated admin console. Ordinary users have no UPDATE/DELETE policy.
CREATE POLICY safety_evidence_admin_manage
ON public.safety_evidence
FOR ALL
TO authenticated
USING (public.is_current_user_admin())
WITH CHECK (public.is_current_user_admin());

REVOKE ALL ON TABLE public.safety_evidence FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.safety_evidence TO authenticated;

-- ---------------------------------------------------------------------------
-- Private bucket and object policies.
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('safety-vault', 'safety-vault', FALSE)
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    public = FALSE;

REVOKE ALL ON TABLE storage.objects FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE storage.objects TO authenticated;

CREATE OR REPLACE FUNCTION public.sw_can_upload_safety_object(
    p_object_name TEXT,
    p_user_id UUID
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT p_user_id IS NOT NULL
       AND p_user_id = auth.uid()
       AND p_object_name ~ '^blackbox/[0-9a-fA-F-]{36}/[^/]+\.(webm|ogg|mp4|m4a|wav)$'
       AND EXISTS (
           SELECT 1
           FROM public.rides AS r
           WHERE r.id = CASE
               WHEN split_part(p_object_name, '/', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
                   THEN split_part(p_object_name, '/', 2)::UUID
               ELSE NULL::UUID
           END
             AND (
                r.driver_id = p_user_id
                OR (
                    p_user_id = ANY(COALESCE(r.participant_ids, ARRAY[]::UUID[]))
                    AND NOT EXISTS (
                        SELECT 1
                        FROM jsonb_array_elements(COALESCE(r.passengers, '[]'::JSONB)) AS cancelled_participant(value)
                        WHERE lower(COALESCE(
                            cancelled_participant.value ->> 'id',
                            cancelled_participant.value ->> 'passenger_id',
                            cancelled_participant.value ->> 'user_id',
                            ''
                        )) = lower(p_user_id::TEXT)
                          AND lower(COALESCE(cancelled_participant.value ->> 'status', '')) IN ('cancelled', 'canceled')
                    )
                )
                OR EXISTS (
                    SELECT 1
                    FROM jsonb_array_elements(COALESCE(r.passengers, '[]'::JSONB)) AS passenger(value)
                     WHERE lower(COALESCE(
                         passenger.value ->> 'id',
                         passenger.value ->> 'passenger_id',
                         passenger.value ->> 'user_id',
                         ''
                     )) = lower(p_user_id::TEXT)
                       AND lower(COALESCE(passenger.value ->> 'status', '')) NOT IN ('cancelled', 'canceled')
                 )
             )
       );
$$;

REVOKE ALL ON FUNCTION public.sw_can_upload_safety_object(TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sw_can_upload_safety_object(TEXT, UUID) TO authenticated;

DROP POLICY IF EXISTS safety_vault_authenticated_upload ON storage.objects;
DROP POLICY IF EXISTS safety_vault_admin_read ON storage.objects;
DROP POLICY IF EXISTS safety_vault_admin_update ON storage.objects;
DROP POLICY IF EXISTS safety_vault_admin_delete ON storage.objects;

CREATE POLICY safety_vault_authenticated_upload
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'safety-vault'
    AND public.sw_can_upload_safety_object(name, auth.uid())
);

CREATE POLICY safety_vault_admin_read
ON storage.objects
FOR SELECT
TO authenticated
USING (
    bucket_id = 'safety-vault'
    AND public.is_current_user_admin()
);

CREATE POLICY safety_vault_admin_update
ON storage.objects
FOR UPDATE
TO authenticated
USING (
    bucket_id = 'safety-vault'
    AND public.is_current_user_admin()
)
WITH CHECK (
    bucket_id = 'safety-vault'
    AND public.is_current_user_admin()
);

CREATE POLICY safety_vault_admin_delete
ON storage.objects
FOR DELETE
TO authenticated
USING (
    bucket_id = 'safety-vault'
    AND public.is_current_user_admin()
);

COMMENT ON TABLE public.safety_evidence IS
    'Private safety evidence metadata. Object access is restricted to authenticated ride members for upload and admins for review.';
