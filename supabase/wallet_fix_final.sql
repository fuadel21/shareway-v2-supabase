-- SCRIPT DE REPARACIÓN DEFINITIVA DE BILLETERA (Final Fix)
-- Este script asegura que la estructura de la base de datos coincida con lo que el código espera, corrigiendo nombres de columnas y tablas faltantes.

DO $$
BEGIN
    -- 1. CORRECCIÓN DE LA TABLA WALLETS
    -- Si existe la columna 'id' pero no 'user_id', la renombramos.
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'wallets' AND column_name = 'id') THEN
        ALTER TABLE public.wallets RENAME COLUMN id TO user_id;
    END IF;

    -- Crear la tabla 'wallets' si no existe
    CREATE TABLE IF NOT EXISTS public.wallets (
      user_id UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
      balance NUMERIC(10, 2) DEFAULT 0.00,
      held_balance NUMERIC(10, 2) DEFAULT 0.00,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );


    -- 2. CORRECCIÓN DE LA TABLA WALLET_TRANSACTIONS
    -- Crear la tabla si no existe
    CREATE TABLE IF NOT EXISTS public.wallet_transactions (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
      amount NUMERIC(10, 2) NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Asegurar que existan todas las columnas necesarias (usamos ADD COLUMN IF NOT EXISTS logic)
    
    -- Agregar 'wallet_id' si falta
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'wallet_transactions' AND column_name = 'wallet_id') THEN
        ALTER TABLE public.wallet_transactions ADD COLUMN wallet_id UUID REFERENCES public.wallets(user_id) ON DELETE CASCADE;
    END IF;

    -- Agregar 'balance_after' si falta
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'wallet_transactions' AND column_name = 'balance_after') THEN
        ALTER TABLE public.wallet_transactions ADD COLUMN balance_after NUMERIC(10, 2);
    END IF;

    -- Agregar 'type' si falta
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'wallet_transactions' AND column_name = 'type') THEN
        ALTER TABLE public.wallet_transactions ADD COLUMN type TEXT;
    END IF;

    -- Agregar 'description' si falta
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'wallet_transactions' AND column_name = 'description') THEN
        ALTER TABLE public.wallet_transactions ADD COLUMN description TEXT;
    END IF;

    -- Agregar 'related_ride_id' si falta
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'wallet_transactions' AND column_name = 'related_ride_id') THEN
        ALTER TABLE public.wallet_transactions ADD COLUMN related_ride_id UUID;
    END IF;

END $$;


-- 3. REDEFINIR FUNCIONES PARA SER COMPATIBLES Y ROBUSTAS

CREATE OR REPLACE FUNCTION public.add_funds(
    p_amount DECIMAL,
    p_payment_method_id TEXT
)
RETURNS JSON AS $$
DECLARE
    v_user_id UUID;
    v_current_balance DECIMAL;
BEGIN
    v_user_id := auth.uid();
    
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'No autenticado';
    END IF;

    -- Actualizar Wallet
    INSERT INTO public.wallets (user_id, balance, updated_at)
    VALUES (v_user_id, p_amount, NOW())
    ON CONFLICT (user_id) 
    DO UPDATE SET 
        balance = public.wallets.balance + excluded.balance,
        updated_at = NOW()
    RETURNING balance INTO v_current_balance;

    -- Registrar Transacción (usamos v_user_id para ambos IDs para asegurar que no falle por nulos)
    INSERT INTO public.wallet_transactions (
        wallet_id, user_id, amount, type, description, balance_after
    ) VALUES (
        v_user_id, 
        v_user_id, 
        p_amount, 
        'deposit', 
        'Recarga de saldo (Stripe: ' || p_payment_method_id || ')', 
        v_current_balance
    );

    RETURN json_build_object('success', true, 'message', 'Fondos añadidos correctamente');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


CREATE OR REPLACE FUNCTION public.request_payout(
    p_amount DECIMAL
)
RETURNS JSON AS $$
DECLARE
    v_user_id UUID;
    v_balance DECIMAL;
BEGIN
    v_user_id := auth.uid();
    
    SELECT balance INTO v_balance FROM public.wallets WHERE user_id = v_user_id;
    
    IF v_balance IS NULL OR v_balance < p_amount THEN
        RAISE EXCEPTION 'Saldo insuficiente';
    END IF;

    UPDATE public.wallets
    SET balance = balance - p_amount, updated_at = NOW()
    WHERE user_id = v_user_id;

    -- Registrar transacción
    INSERT INTO public.wallet_transactions (
        wallet_id, user_id, amount, type, description, balance_after
    ) VALUES (
        v_user_id, 
        v_user_id, 
        -p_amount, 
        'withdraw', 
        'Solicitud de retiro', 
        v_balance - p_amount
    );
    
    RETURN json_build_object('success', true, 'message', 'Retiro solicitado');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
