-- Añadir campos de configuración de viaje a Rutas Habituales
ALTER TABLE public.favorite_routes
ADD COLUMN IF NOT EXISTS seats INTEGER DEFAULT 4,
ADD COLUMN IF NOT EXISTS price NUMERIC(10, 2) DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS departure_time TIME WITHOUT TIME ZONE;

COMMENT ON COLUMN public.favorite_routes.departure_time IS 'Hora del día preferida para esta ruta (HH:MM:SS)';
