-- Habilitar PostGIS para cálculos geoespaciales precisos
CREATE EXTENSION IF NOT EXISTS postgis;

-- Función de Matching Avanzado: "Intercepción de Ruta"
-- Esta función busca viajes que:
-- 1. Tengan plazas disponibles.
-- 2. El origen o algún waypoint pase cerca del pasajero.
-- 3. El destino sea similar.
CREATE OR REPLACE FUNCTION public.find_matching_rides_v2(
    p_passenger_origin_lat DECIMAL,
    p_passenger_origin_lng DECIMAL,
    p_passenger_dest_lat DECIMAL,
    p_passenger_dest_lng DECIMAL,
    p_radius_meters FLOAT DEFAULT 3000, -- 3km de margen
    p_dest_radius_meters FLOAT DEFAULT 5000 -- 5km de margen en destino
) RETURNS TABLE (
    ride_id UUID,
    driver_id UUID,
    seats_available INT,
    price_per_seat DECIMAL,
    distance_to_pickup FLOAT,
    match_type TEXT, -- 'direct' (origen cerca) o 'interception' (paso cerca)
    driver_name TEXT,
    driver_photo_url TEXT
) AS $$
BEGIN
    RETURN QUERY
    WITH ride_candidates AS (
        SELECT
            r.*,
            u.display_name as d_name,
            u.photo_url as d_photo,
            -- Distancia desde origen del conductor al origen del pasajero
            ST_Distance(
                ST_SetSRID(ST_MakePoint(p_passenger_origin_lng, p_passenger_origin_lat), 4326)::geography,
                ST_SetSRID(ST_MakePoint((r.origin->>'lng')::DECIMAL, (r.origin->>'lat')::DECIMAL), 4326)::geography
            ) as dist_origin,
            -- Distancia desde destino del conductor al destino del pasajero
            ST_Distance(
                ST_SetSRID(ST_MakePoint(p_passenger_dest_lng, p_passenger_dest_lat), 4326)::geography,
                ST_SetSRID(ST_MakePoint((r.destination->>'lng')::DECIMAL, (r.destination->>'lat')::DECIMAL), 4326)::geography
            ) as dist_dest
        FROM public.rides r
        JOIN public.profiles u ON r.driver_id = u.id
        WHERE r.status = 'scheduled'
          AND r.departure_time > NOW()
          AND r.seats_available > 0
    )
    SELECT
        id,
        driver_id,
        seats_available,
        price,
        dist_origin,
        CASE
            WHEN dist_origin <= 1000 THEN 'direct'
            ELSE 'interception'
        END as match_type,
        d_name,
        d_photo
    FROM ride_candidates
    WHERE (dist_origin <= p_radius_meters) -- El origen está cerca
      AND (dist_dest <= p_dest_radius_meters); -- El destino coincide razonablemente
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
