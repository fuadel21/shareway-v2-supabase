-- Add missing columns to rides table for tracking lifecycle
ALTER TABLE public.rides
ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;