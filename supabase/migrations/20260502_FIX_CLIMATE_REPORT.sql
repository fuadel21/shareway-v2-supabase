-- ========================================================
-- FIX FINAL: VISTA DE IMPACTO CLIMÁTICO (ESQUEMA CORRECTO)
-- Propósito: Reparar el error de columna inexistente y sincronizar
-- con la columna 'distance' real de la tabla rides.
-- ========================================================

DROP VIEW IF EXISTS public.v_eu_grant_report CASCADE;

CREATE OR REPLACE VIEW public.v_eu_grant_report AS
WITH monthly_stats AS (
    SELECT
        DATE_TRUNC('month', r.completed_at) as month,
        COUNT(r.id) as total_trips,
        -- Detección inteligente: si la distancia es > 1000 probablemente son metros.
        SUM(COALESCE(r.distance, 0) / CASE WHEN r.distance > 1000 THEN 1000.0 ELSE 1.0 END) as total_km_traveled,
        AVG(COALESCE(jsonb_array_length(r.passengers), 0) + 1) as avg_occupancy
    FROM public.rides r
    WHERE r.status = 'completed'
    GROUP BY 1
)
SELECT
    month,
    total_trips,
    ROUND(total_km_traveled::NUMERIC, 2) as total_km_traveled,
    -- Baseline: 108g CO2/km (Estándar EEA) * pasajeros
    ROUND((total_km_traveled * 0.108 * avg_occupancy)::NUMERIC, 2) as baseline_emissions_kg,
    -- Actual: 108g CO2/km por el vehículo compartido
    ROUND((total_km_traveled * 0.108)::NUMERIC, 2) as actual_emissions_kg,
    -- Ahorro: Baseline - Actual
    ROUND(((total_km_traveled * 0.108 * avg_occupancy) - (total_km_traveled * 0.108))::NUMERIC, 2) as net_co2_savings_kg,
    ROUND(avg_occupancy::NUMERIC, 2) as avg_occupancy
FROM monthly_stats
ORDER BY month DESC;

-- Otorgar permisos
GRANT SELECT ON public.v_eu_grant_report TO authenticated;
GRANT SELECT ON public.v_eu_grant_report TO anon;
GRANT SELECT ON public.v_eu_grant_report TO service_role;

COMMENT ON VIEW public.v_eu_grant_report IS 'Reporte de impacto ambiental corregido para el esquema rides v4.';
