DO $$ BEGIN -- 1. Agregar stripe_account_id si no existe (Para Connect/Conductores)
IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'profiles'
        AND column_name = 'stripe_account_id'
) THEN
ALTER TABLE public.profiles
ADD COLUMN stripe_account_id TEXT;
RAISE NOTICE 'Columna stripe_account_id creada.';
END IF;
-- 2. Asegurar stripe_customer_id (Para Pagos/Pasajeros)
IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'profiles'
        AND column_name = 'stripe_customer_id'
) THEN
ALTER TABLE public.profiles
ADD COLUMN stripe_customer_id TEXT;
RAISE NOTICE 'Columna stripe_customer_id creada.';
END IF;
-- 3. Asegurar stripe_account_verified (Booleano para lógica rápida)
IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'profiles'
        AND column_name = 'stripe_account_verified'
) THEN
ALTER TABLE public.profiles
ADD COLUMN stripe_account_verified BOOLEAN DEFAULT FALSE;
RAISE NOTICE 'Columna stripe_account_verified creada.';
END IF;
-- 4. MIGRACIÓN DE DATOS (Heurística)
-- Si stripe_customer_id tiene un valor que empieza con 'acct_', moverlo a stripe_account_id
UPDATE public.profiles
SET stripe_account_id = stripe_customer_id,
    stripe_customer_id = NULL
WHERE stripe_customer_id LIKE 'acct_%'
    AND stripe_account_id IS NULL;
-- 5. Asegurar que 'verification' sea un objeto JSONB válido
UPDATE public.profiles
SET verification = '{"status": "not_verified"}'::jsonb
WHERE verification IS NULL;
-- 6. Sincronizar campo JSONB basado en el booleano
UPDATE public.profiles
SET verification = verification || jsonb_build_object(
        'stripe_enabled',
        COALESCE(stripe_account_verified, false)
    )
WHERE verification IS NOT NULL;
RAISE NOTICE 'Sincronización de perfiles completada con éxito.';
END $$;