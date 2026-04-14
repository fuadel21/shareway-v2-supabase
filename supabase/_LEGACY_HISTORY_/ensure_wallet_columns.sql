-- Asegurar que la tabla wallets tenga la columna held_balance
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'wallets' AND column_name = 'held_balance') THEN
        ALTER TABLE public.wallets ADD COLUMN held_balance NUMERIC(10, 2) DEFAULT 0.00;
        RAISE NOTICE 'Columna held_balance creada exitosamente.';
    ELSE
        RAISE NOTICE 'La columna held_balance ya existe.';
    END IF;
END $$;

-- Asegurar políticas de lectura
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own wallet" ON public.wallets;
CREATE POLICY "Users can view their own wallet" ON public.wallets FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own wallet" ON public.wallets;
CREATE POLICY "Users can update their own wallet" ON public.wallets FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own wallet" ON public.wallets;
CREATE POLICY "Users can insert their own wallet" ON public.wallets FOR INSERT WITH CHECK (auth.uid() = user_id);
