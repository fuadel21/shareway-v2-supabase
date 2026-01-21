-- Asegurar que la tabla rides tiene columnas para seguimiento en tiempo real
ALTER TABLE public.rides 
ADD COLUMN IF NOT EXISTS current_location JSONB,
ADD COLUMN IF NOT EXISTS last_location_update TIMESTAMPTZ;

-- Comentario para documentar las columnas
COMMENT ON COLUMN public.rides.current_location IS 'Almacena {lat, lng} del conductor durante el viaje activo';
COMMENT ON COLUMN public.rides.last_location_update IS 'Marca de tiempo de la última actualización de GPS';
