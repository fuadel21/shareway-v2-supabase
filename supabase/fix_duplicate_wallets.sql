-- SCRIPT DE LIMPIEZA DE BILLETERAS DUPLICADAS
-- Este script fusiona filas duplicadas en la tabla 'wallets' y establece una restricción para evitar que vuelva a suceder.

DO $$
DECLARE
    dup_record RECORD;
    v_total_balance DECIMAL;
    v_total_held DECIMAL;
BEGIN
    -- 1. Detectar usuarios con múltiples entradas en wallets
    FOR dup_record IN 
        SELECT user_id FROM public.wallets GROUP BY user_id HAVING COUNT(*) > 1
    LOOP
        -- 2. Calcular la suma total de sus saldos
        SELECT SUM(balance), SUM(held_balance) 
        INTO v_total_balance, v_total_held 
        FROM public.wallets WHERE user_id = dup_record.user_id;
        
        -- 3. Eliminar todas las entradas de ese usuario
        DELETE FROM public.wallets WHERE user_id = dup_record.user_id;

        -- 4. Insertar una única entrada consolidada
        INSERT INTO public.wallets (user_id, balance, held_balance, updated_at) 
        VALUES (dup_record.user_id, COALESCE(v_total_balance, 0), COALESCE(v_total_held, 0), NOW());
        
        RAISE NOTICE 'Billetera fusionada para usuario: % (Saldo: %)', dup_record.user_id, v_total_balance;
    END LOOP;
END $$;

-- 5. Asegurar que user_id sea Primary Key para impedir duplicados futuros
DO $$
BEGIN
    -- Si no hay PK, la agregamos
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE table_name = 'wallets' AND constraint_type = 'PRIMARY KEY') THEN
        -- Verificar si hay índice único primero para evitar error si ya existe
        ALTER TABLE public.wallets ADD PRIMARY KEY (user_id);
    END IF;
END $$;
