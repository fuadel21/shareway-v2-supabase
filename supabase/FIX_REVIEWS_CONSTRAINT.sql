-- ==============================================================================
-- FIX: REVIEWS UNIQUE CONSTRAINT
-- ==============================================================================
-- Este script soluciona el error "there is no unique or exclusion constraint matching the ON CONFLICT specification"
-- al publicar una valoración.
-- ==============================================================================
-- 1. Añade índice único compuesto para (ride_id, author_id, target_id)
-- Esto asegura que un usuario solo pueda valorar a otro usuario una vez por viaje.
CREATE UNIQUE INDEX IF NOT EXISTS idx_reviews_unique_participation ON public.reviews (ride_id, author_id, target_id);
-- 2. Opcional: Si el ON CONFLICT usa el nombre de la constraint explícitamente, 
-- se puede necesitar ALTER TABLE ADD CONSTRAINT. 
-- Pero PostgreSQL suele usar el índice único automáticamente para ON CONFLICT.
-- Para estar seguros, añadimos la constraint formalmente.
DO $$ BEGIN IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'reviews_ride_author_target_key'
) THEN
ALTER TABLE public.reviews
ADD CONSTRAINT reviews_ride_author_target_key UNIQUE USING INDEX idx_reviews_unique_participation;
END IF;
EXCEPTION
WHEN others THEN NULL;
-- Ignorar si ya existe o hay conflicto de datos
END $$;