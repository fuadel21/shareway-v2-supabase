-- Live Stripe prepare upserts ride_requests with the user JWT.
-- RLS was select-only after 20260707, so card booking failed with:
-- new row violates row-level security policy for table "ride_requests"

DROP POLICY IF EXISTS "ride_requests_insert_own_pending" ON public.ride_requests;
DROP POLICY IF EXISTS "ride_requests_update_own_pending" ON public.ride_requests;
DROP POLICY IF EXISTS "ride_requests_service_role_all" ON public.ride_requests;

CREATE POLICY "ride_requests_insert_own_pending"
ON public.ride_requests
FOR INSERT
TO authenticated
WITH CHECK (
  requester_id = auth.uid()
  AND lower(COALESCE(status, 'pending')) IN (
    'pending',
    'requested',
    'awaiting_payment',
    'processing',
    'unpaid'
  )
);

CREATE POLICY "ride_requests_update_own_pending"
ON public.ride_requests
FOR UPDATE
TO authenticated
USING (
  requester_id = auth.uid()
  AND lower(COALESCE(status, '')) IN (
    'pending',
    'requested',
    'awaiting_payment',
    'processing',
    'unpaid'
  )
)
WITH CHECK (
  requester_id = auth.uid()
  AND lower(COALESCE(status, 'pending')) IN (
    'pending',
    'requested',
    'awaiting_payment',
    'processing',
    'unpaid'
  )
);

CREATE POLICY "ride_requests_service_role_all"
ON public.ride_requests
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);
