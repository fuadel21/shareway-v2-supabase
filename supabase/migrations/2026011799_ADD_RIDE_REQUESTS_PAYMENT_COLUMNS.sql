-- Add missing columns to ride_requests table for Stripe payment integration
-- These columns are needed by the create-booking-payment-intent Edge Function
ALTER TABLE public.ride_requests
ADD COLUMN IF NOT EXISTS amount DECIMAL(10, 2),
    ADD COLUMN IF NOT EXISTS payment_intent_id TEXT,
    ADD COLUMN IF NOT EXISTS pin TEXT,
    ADD COLUMN IF NOT EXISTS pickup_location JSONB,
    ADD COLUMN IF NOT EXISTS pickup_address TEXT;
-- Add index for faster payment_intent_id lookups
CREATE INDEX IF NOT EXISTS idx_ride_requests_payment_intent ON public.ride_requests(payment_intent_id)
WHERE payment_intent_id IS NOT NULL;
-- Add comment for documentation
COMMENT ON COLUMN public.ride_requests.amount IS 'Amount to be charged for this booking (in EUR)';
COMMENT ON COLUMN public.ride_requests.payment_intent_id IS 'Stripe Payment Intent ID for tracking payment status';
COMMENT ON COLUMN public.ride_requests.pin IS 'Verification PIN for passenger boarding';
COMMENT ON COLUMN public.ride_requests.pickup_location IS 'Custom pickup location coordinates {lat, lng}';
COMMENT ON COLUMN public.ride_requests.pickup_address IS 'Human-readable pickup address';