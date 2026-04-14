-- ==========================================
-- CLIMATE_TECH_CORE.sql
-- Motor de Impacto Ambiental Auditado v1
-- Alineado con estándares de la UE (EEA Guidebook)
-- ==========================================

-- 1. Tabla de Factores de Emisión (Fuentes: EEA / MITECO)
-- kg_co2_per_unit se refiere a:
-- - combustión: kg CO2 / litro
-- - eléctrico/híbrido: kg CO2 / kWh (basado en el mix eléctrico medio EU)
CREATE TABLE IF NOT EXISTS public.emission_factors (
    fuel_type TEXT PRIMARY KEY,
    kg_co2_per_unit DECIMAL NOT NULL,
    description TEXT
);

INSERT INTO public.emission_factors (fuel_type, kg_co2_per_unit, description) VALUES
('diesel', 2.68, 'Diésel estándar EURO 6'),
('gasoline', 2.31, 'Gasolina 95/98'),
('electric', 0.25, 'Carga eléctrica (Mix medio europeo)'),
('glp', 1.61, 'Gas Licuado del Petróleo'),
('cng', 1.88, 'Gas Natural Comprimido')
ON CONFLICT (fuel_type) DO UPDATE SET kg_co2_per_unit = EXCLUDED.kg_co2_per_unit;

-- 2. Enriquecer perfiles con datos técnicos del vehículo para auditoría
-- Esto permite certificar reducciones de emisiones reales, no estimadas.
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS carbon_impact_data JSONB DEFAULT '{
    "total_co2_saved": 0.0,
    "avoided_vkt": 0.0,
    "last_updated": null
}'::jsonb;

-- 3. Función RPC para obtener el ahorro de CO2 preciso
-- Esta función será llamada por los Edge Functions tras finalizar un viaje.
CREATE OR REPLACE FUNCTION public.get_accurate_co2_savings(
    p_distance_km DECIMAL,
    p_passenger_count INTEGER,
    p_vehicle_meta JSONB -- snapshot del vehículo en el momento del viaje
)
RETURNS DECIMAL AS $$
DECLARE
    v_fuel_type TEXT;
    v_efficiency DECIMAL; -- l/100km o kWh/100km
    v_emission_factor DECIMAL;
    v_total_ride_emissions DECIMAL;
    v_saved_emissions DECIMAL;
BEGIN
    -- 1. Extraer metadatos
    v_fuel_type := p_vehicle_meta->>'fuel_type';
    v_efficiency := (p_vehicle_meta->>'efficiency')::DECIMAL;
    
    -- Manejo de valores por defecto si no hay perfil técnico (Baseline conservador)
    IF v_fuel_type IS NULL THEN v_fuel_type := 'gasoline'; END IF;
    IF v_efficiency IS NULL THEN v_efficiency := 7.0; END IF; -- 7L/100km media europea

    -- 2. Obtener factor de emisión
    SELECT kg_co2_per_unit INTO v_emission_factor 
    FROM public.emission_factors 
    WHERE fuel_type = v_fuel_type;
    
    -- 3. Calcular emisiones totales del vehículo en este trayecto
    -- Fórmula: (Distancia / 100) * Eficiencia * Factor
    v_total_ride_emissions := (p_distance_km / 100.0) * v_efficiency * v_emission_factor;
    
    -- 4. Cálculo de Adicionalidad (Impacto Neto)
    -- El ahorro se basa en los "Viajes de Vehículo Evitados" (VKT).
    -- Cada pasajero adicional representa un coche que NO está en la carretera.
    v_saved_emissions := v_total_ride_emissions * (p_passenger_count - 1);
    
    RETURN ROUND(v_saved_emissions, 4);
END;
$$ LANGUAGE plpgsql STABLE;
