-- ==============================================================================
-- 20260510_TREASURY_INITIALIZATION.sql
-- Inicialización física de la entidad Tesorería (Sistema)
-- ==============================================================================

DO $$
DECLARE
    v_treasury_id UUID := '00000000-0000-0000-0000-000000000000';
BEGIN
    -- 1. Crear usuario en auth.users si no existe (Necesario para integridad referencial)
    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_treasury_id) THEN
        INSERT INTO auth.users (id, email, raw_user_meta_data, created_at, updated_at, role, aud, confirmation_token)
        VALUES (
            v_treasury_id,
            'treasury@shareway.app',
            '{"full_name": "Tesorería Shareway"}'::jsonb,
            NOW(), NOW(),
            'authenticated', 'authenticated',
            'system-account'
        );
    END IF;

    -- 2. Crear perfil si no existe
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_treasury_id) THEN
        INSERT INTO public.profiles (id, full_name, email, role)
        VALUES (v_treasury_id, 'Tesorería Shareway', 'treasury@shareway.app', 'admin');
    END IF;

    -- 3. Asegurar la Wallet
    IF NOT EXISTS (SELECT 1 FROM public.wallets WHERE user_id = v_treasury_id) THEN
        INSERT INTO public.wallets (user_id, balance, held_balance)
        VALUES (v_treasury_id, 0.00, 0.00);
    END IF;

END $$;
