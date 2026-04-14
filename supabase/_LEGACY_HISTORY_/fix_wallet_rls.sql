-- SCRIPT DE PERMISOS (RLS) PARA LA BILLETERA
-- El saldo aparece en 0 porque el usuario no tiene permiso para leer su propia tabla 'wallets' desde el frontend.

-- 1. Habilitar seguridad a nivel de fila
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;

-- 2. Limpiar políticas antiguas para evitar duplicados/errores
DROP POLICY IF EXISTS "Users can view their own wallet" ON public.wallets;
DROP POLICY IF EXISTS "Users can read own wallet" ON public.wallets;
DROP POLICY IF EXISTS "Users can insert their own wallet" ON public.wallets; -- Por si acaso
DROP POLICY IF EXISTS "Users can update their own wallet" ON public.wallets; -- Por si acaso

-- 3. Crear política de LECTURA para wallets
-- Permite que el usuario logueado (auth.uid()) vea solo su fila (user_id = auth.uid())
CREATE POLICY "Users can view their own wallet" ON public.wallets
    FOR SELECT USING (auth.uid() = user_id);

-- 4. Crear política de LECTURA para transacciones (aunque parece funcionar, aseguramos)
DROP POLICY IF EXISTS "Users can view their own transactions" ON public.wallet_transactions;

CREATE POLICY "Users can view their own transactions" ON public.wallet_transactions
    FOR SELECT
    USING (auth.uid() = user_id);
