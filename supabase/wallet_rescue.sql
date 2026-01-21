-- SCRIPT DE RESCATE DE BILLETERA (ALL-IN-ONE)
-- Soluciona: Error 400 (Falta columna), Duplicados, Primary Key y RLS.

DO $$
DECLARE
    dup_record RECORD;
    v_total_balance DECIMAL;
    v_total_held DECIMAL;
BEGIN
    -- 1. CORREGIR COLUMNA FALTANTE (Causa principal del error 400 en consola)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'wallets' AND column_name = 'held_balance') THEN
        ALTER TABLE public.wallets ADD COLUMN held_balance NUMERIC(10, 2) DEFAULT 0.00;
        RAISE NOTICE 'Columna held_balance creada exitosamente.';
    END IF;

    -- 2. LIMPIEZA DE DUPLICADOS (Fusionar saldos si existen múltiples filas)
    FOR dup_record IN 
        SELECT user_id FROM public.wallets GROUP BY user_id HAVING COUNT(*) > 1
    LOOP
        -- Calcular totales
        SELECT SUM(balance), SUM(held_balance) 
        INTO v_total_balance, v_total_held 
        FROM public.wallets WHERE user_id = dup_record.user_id;
        
        -- Borrar todo
        DELETE FROM public.wallets WHERE user_id = dup_record.user_id;

        -- Insertar consolidado
        INSERT INTO public.wallets (user_id, balance, held_balance, updated_at) 
        VALUES (dup_record.user_id, COALESCE(v_total_balance, 0), COALESCE(v_total_held, 0), NOW());
    END LOOP;

    -- 3. VALIDACIÓN DE ESTRUCTURA (Primary Key Fix)
    -- Esto previene que se vuelvan a crear duplicados en el futuro
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE table_name = 'wallets' AND constraint_type = 'PRIMARY KEY') THEN
        ALTER TABLE public.wallets ADD PRIMARY KEY (user_id);
    END IF;

    -- 4. PERMISOS DE LECTURA (RLS FIX)
    -- Asegurar que el usuario puede leer su propio saldo
    -- (Borramos y recreamos para estar 100% seguros)
    
END $$;

-- Ejecutar DDL fuera del bloque PL/pgSQL para evitar problemas de anidamiento con Policies
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view their own wallet" ON public.wallets;
CREATE POLICY "Users can view their own wallet" ON public.wallets FOR SELECT USING (auth.uid() = user_id);

-- Confirmación
SELECT 'Wallet rescatada exitosamente. Por favor recarga la página.' as status;
