-- ==============================================================================
-- FEATURE: SMART MATCHING ENGINE (Polyline Support)
-- ==============================================================================
-- Objetivo: Permitir búsquedas de viajes que pasan CERCA de un punto, no solo
--           los que salen exactamente del origen.
-- ==============================================================================
-- 1. Asegurar extensión PostGIS
CREATE EXTENSION IF NOT EXISTS postgis;
-- 2. Añadir columna geométrica a RIDES
-- Guardará la línea física de la ruta para cálculos espaciales rápidos.
ALTER TABLE public.rides
ADD COLUMN IF NOT EXISTS route_geom GEOGRAPHY(LINESTRING, 4326);
CREATE INDEX IF NOT EXISTS idx_rides_route_geom ON public.rides USING GIST(route_geom);
-- 3. Función auxiliar para decodificar Polyline (Google Format) a Geometría
-- Nota: PostGIS 3.0+ suele tener ST_LineFromEncodedPolyline. Si no, necesitamos polyfill.
-- Asumimos entorno moderno. Si fallase, habría que inyectar el código decodificador PL/pgSQL.
-- 4. Trigger para auto-calcular route_geom al insertar/actualizar
CREATE OR REPLACE FUNCTION public.update_ride_geometry() RETURNS TRIGGER AS $$ BEGIN -- Solo si hay polyline y cambió
    IF NEW.overview_polyline IS NOT NULL
    AND (
        OLD.overview_polyline IS DISTINCT
        FROM NEW.overview_polyline
            OR NEW.route_geom IS NULL
    ) THEN BEGIN -- Intentar decodificar la polilínea (precisión 5 que es estándar Google)
    NEW.route_geom := ST_LineFromEncodedPolyline(NEW.overview_polyline, 5);
EXCEPTION
WHEN OTHERS THEN -- Si falla (polyline corrupta), loguear y dejar nulo para no romper el insert
RAISE WARNING 'Error decodificando polyline para ride %: %',
NEW.id,
SQLERRM;
NEW.route_geom := NULL;
END;
END IF;
RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS tr_rides_update_geometry ON public.rides;
CREATE TRIGGER tr_rides_update_geometry BEFORE
INSERT
    OR
UPDATE OF overview_polyline ON public.rides FOR EACH ROW EXECUTE FUNCTION public.update_ride_geometry();
-- 5. FUNCIÓN BUSCADORA INTELIGENTE (BETA)
-- Busca viajes que pasen a menos de `p_tolerance_meters` del origen y destino del pasajero.
CREATE OR REPLACE FUNCTION public.search_rides_smart_v1(
        p_origin_lat FLOAT,
        p_origin_lng FLOAT,
        p_dest_lat FLOAT,
        p_dest_lng FLOAT,
        p_date DATE,
        p_tolerance_meters INT DEFAULT 5000 -- 5km de desvío máximo
    ) RETURNS TABLE (
        id UUID,
        driver_id UUID,
        origin JSONB,
        destination JSONB,
        price DECIMAL,
        seats_available INT,
        detour_seconds INT,
        -- Cuánto representa desviarse (aproximado)
        match_type TEXT -- 'exact' o 'on_route'
    ) AS $$
DECLARE v_origin_pt GEOMETRY;
v_dest_pt GEOMETRY;
BEGIN v_origin_pt := ST_SetSRID(ST_MakePoint(p_origin_lng, p_origin_lat), 4326);
v_dest_pt := ST_SetSRID(ST_MakePoint(p_dest_lng, p_dest_lat), 4326);
RETURN QUERY
SELECT r.id,
    r.driver_id,
    r.origin,
    r.destination,
    r.price,
    r.seats_available,
    0 as detour_seconds,
    -- Placeholder para cálculo complejo futuro
    CASE
        WHEN ST_DWithin(
            r.origin->>'lat'::text || ' ' || r.origin->>'lng'::text,
            v_origin_pt::geography,
            p_tolerance_meters
        ) THEN 'exact'
        ELSE 'on_route'
    END as match_type
FROM public.rides r
WHERE r.status = 'scheduled'
    AND r.seats_available > 0
    AND r.departure_time::DATE = p_date
    AND r.route_geom IS NOT NULL -- Condición 1: La ruta pasa cerca del origen del pasajero
    AND ST_DWithin(
        r.route_geom,
        v_origin_pt::geography,
        p_tolerance_meters
    ) -- Condición 2: La ruta pasa cerca del destino del pasajero
    AND ST_DWithin(
        r.route_geom,
        v_dest_pt::geography,
        p_tolerance_meters
    ) -- Condición 3 (CRÍTICA): El punto más cercano al origen está ANTES en la ruta que el punto del destino
    -- ST_LineLocatePoint devuelve un float 0.0 a 1.0 indicando posición en la línea.
    AND ST_LineLocatePoint(r.route_geom::geometry, v_origin_pt) < ST_LineLocatePoint(r.route_geom::geometry, v_dest_pt);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;