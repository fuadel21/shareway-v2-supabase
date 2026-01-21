-- SCRIPT DE REPARACIÓN DE BILLETERA (Wallets & Transactions)

-- BLOQUE ANÓNIMO para corregir estructura de tabla WALLETS
DO $$
BEGIN
    -- 1. Verificar si la columna se llama 'id' en lugar de 'user_id' y corregirlo
    -- Esto es común si la tabla se creó con references auth.users directamente como PK
    IF EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'wallets' AND column_name = 'id'
    ) THEN
        ALTER TABLE public.wallets RENAME COLUMN id TO user_id;
    END IF;

    -- 2. Si la tabla no existe, crearla correctamente
    CREATE TABLE IF NOT EXISTS public.wallets (
      user_id UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
      balance NUMERIC(10, 2) DEFAULT 0.00,
      held_balance NUMERIC(10, 2) DEFAULT 0.00,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
END $$;

-- 3. Asegurar que exista la tabla de transacciones 'wallet_transactions'
-- Usamos este nombre para evitar conflictos con palabras reservadas y ser consistentes con el código JS actualizado
CREATE TABLE IF NOT EXISTS public.wallet_transactions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  wallet_id UUID REFERENCES public.wallets(user_id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  amount NUMERIC(10, 2) NOT NULL,
  balance_after NUMERIC(10, 2),
  type TEXT, 
  description TEXT,
  related_ride_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Definir las funciones RPC corregidas

-- Función: add_funds
CREATE OR REPLACE FUNCTION public.add_funds(
    p_amount DECIMAL,
    p_payment_method_id TEXT
)
RETURNS JSON AS $$
DECLARE
    v_user_id UUID;
BEGIN
    v_user_id := auth.uid();
    
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'No autenticado';
    END IF;

    -- Upsert en wallets (insertar o actualizar)
    INSERT INTO public.wallets (user_id, balance, updated_at)
    VALUES (v_user_id, p_amount, NOW())
    ON CONFLICT (user_id) 
    DO UPDATE SET 
        balance = public.wallets.balance + excluded.balance,
        updated_at = NOW();

    -- Registrar Transacción en wallet_transactions
    INSERT INTO public.wallet_transactions (wallet_id, user_id, amount, type, description, balance_after)
    SELECT 
        v_user_id, 
        v_user_id, 
        p_amount, 
        'deposit', 
        'Recarga de saldo (Stripe: ' || p_payment_method_id || ')', 
        balance
    FROM public.wallets 
    WHERE user_id = v_user_id;

    RETURN json_build_object('success', true, 'message', 'Fondos añadidos correctamente');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- Función: request_payout
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

    INSERT INTO public.wallet_transactions (wallet_id, user_id, amount, type, description, balance_after)
    VALUES (v_user_id, v_user_id, -p_amount, 'withdraw', 'Solicitud de retiro', v_balance - p_amount);
    
    RETURN json_build_object('success', true, 'message', 'Retiro solicitado');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
