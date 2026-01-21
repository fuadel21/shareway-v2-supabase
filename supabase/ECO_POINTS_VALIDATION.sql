-- ==============================================================================
-- SCRIPT DE VALIDACIÓN DEL SISTEMA DE ECO-PUNTOS Y AUDITORÍA CLIMÁTICA
-- ==============================================================================
-- Instrucciones:
-- Ejecuta este script paso a paso en el Editor SQL de Supabase para verificar
-- que los triggers y funciones de sostenibilidad están operando correctamente.
-- ==============================================================================

-- PASO 1: Identificar un usuario y un viaje de prueba
-- Seleccionamos un usuario cualquiera y un viaje programado o activo
WITH test_data AS (
  SELECT 
    r.id as ride_id,
    r.driver_id,
    p.email
  FROM rides r
  JOIN profiles p ON r.driver_id = p.id
  WHERE r.status IN ('scheduled', 'active') 
  LIMIT 1
)
SELECT * FROM test_data;

-- PASO 2: Verificar estado inicial de puntos
-- Sustituye 'DRIVER_ID' con el ID obtenido en el paso 1
SELECT id, email, eco_points, eco_tier, total_co2_saved 
FROM profiles 
WHERE id = 'DRIVER_ID'; -- <--- PEGAR ID AQUÍ

-- PASO 3: Simular Finalización de Viaje
-- Esto debería disparar:
-- 1. trigger_calculate_climate_impact (calcular CO2 ahorrado)
-- 2. trigger_award_eco_incentives (dar puntos al conductor)
-- 3. Registro en climate_audit_logs

-- NOTA: Asegúrate de usar el ride_id correcto del Paso 1
UPDATE rides 
SET status = 'completed' 
WHERE id = 'RIDE_ID'; -- <--- PEGAR RIDE ID AQUÍ

-- PASO 4: Verificar Resultados

-- A. Verificar Puntos y Tier actualizados
SELECT id, email, eco_points, eco_tier, total_co2_saved 
FROM profiles 
WHERE id = 'DRIVER_ID';

-- B. Verificar Auditoría Climática (Debe haber un nuevo registro)
SELECT * 
FROM climate_audit_logs 
WHERE ride_id = 'RIDE_ID';

-- C. Verificar Historial de Puntos (Opcional, si implementamos tabla de historial)
-- Si solo actualizamos el perfil, el paso A es suficiente.

-- ==============================================================================
-- RESULTADOS ESPERADOS:
-- 1. profiles.eco_points debe haber aumentado (aprox 10 pts/km).
-- 2. profiles.total_co2_saved debe haber aumentado.
-- 3. climate_audit_logs debe tener una fila con los detalles del cálculo.
-- ==============================================================================
