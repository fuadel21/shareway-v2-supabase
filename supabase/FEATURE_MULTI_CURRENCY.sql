-- ==============================================================================
-- FEATURE: MULTI-CURRENCY & INTERNATIONALIZATION
-- ==============================================================================
-- Objetivo: Soportar múltiples países y monedas con configuraciones dinámicas.
-- ==============================================================================
-- 1. Tabla de Configuración Regional
CREATE TABLE IF NOT EXISTS public.country_configs (
    country_code CHAR(2) PRIMARY KEY,
    -- ISO 3166-1 alpha-2 (ES, MX, US)
    currency_code CHAR(3) NOT NULL,
    -- ISO 4217 (EUR, MXN, USD)
    currency_symbol VARCHAR(5) NOT NULL,
    -- €, $, MX$
    price_per_km_limit DECIMAL NOT NULL,
    -- Límite anti-lucro
    min_payout_amount DECIMAL NOT NULL,
    -- Mínimo para retirar
    platform_fee_percent DECIMAL DEFAULT 10.0,
    -- Comisión de ShareWay
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
-- 2. Datos Semilla (Defaults)
INSERT INTO public.country_configs (
        country_code,
        currency_code,
        currency_symbol,
        price_per_km_limit,
        min_payout_amount
    )
VALUES ('ES', 'EUR', '€', 0.60, 5.00),
    -- España (Base actual)
    ('MX', 'MXN', '$', 15.00, 100.00),
    -- México (Ejemplo: ~15 pesos/km)
    ('US', 'USD', '$', 0.65, 10.00),
    -- USA
    ('CO', 'COP', '$', 3000.00, 20000.00) -- Colombia
    ON CONFLICT (country_code) DO
UPDATE
SET price_per_km_limit = EXCLUDED.price_per_km_limit;
-- 3. Función Helper para obtener configuración por país
CREATE OR REPLACE FUNCTION public.get_country_config(p_country_code TEXT) RETURNS JSON AS $$
DECLARE v_config JSON;
BEGIN
SELECT row_to_json(c) INTO v_config
FROM public.country_configs c
WHERE c.country_code = UPPER(p_country_code)
    AND c.is_active = TRUE;
IF v_config IS NULL THEN -- Fallback a España o Default si no se encuentra
SELECT row_to_json(c) INTO v_config
FROM public.country_configs c
WHERE c.country_code = 'ES';
END IF;
RETURN v_config;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 4. Modificación de Tablas para soportar moneda (No intrusiva, con default EUR)
DO $$ BEGIN -- Tabla RIDEs
IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'rides'
        AND column_name = 'currency'
) THEN
ALTER TABLE public.rides
ADD COLUMN currency CHAR(3) DEFAULT 'EUR';
END IF;
IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'rides'
        AND column_name = 'country'
) THEN
ALTER TABLE public.rides
ADD COLUMN country CHAR(2) DEFAULT 'ES';
END IF;
-- Tabla WALLETS (¡Ojo! Un wallet debería ser multidivisa o tener balances separados. Por ahora simplificamos: wallet en moneda base del usuario).
IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'wallets'
        AND column_name = 'currency'
) THEN
ALTER TABLE public.wallets
ADD COLUMN currency CHAR(3) DEFAULT 'EUR';
END IF;
END $$;