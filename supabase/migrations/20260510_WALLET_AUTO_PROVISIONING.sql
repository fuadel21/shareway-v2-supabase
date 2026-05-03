-- ==============================================================================
-- 20260510_WALLET_AUTO_PROVISIONING.sql
-- Garantiza que cada perfil tenga una billetera asociada automáticamente.
-- ==============================================================================

-- 1. Función de aprovisionamiento de Wallet
CREATE OR REPLACE FUNCTION public.provision_wallet_for_profile()
RETURNS TRIGGER AS $$
BEGIN
    -- Crear wallet si no existe
    INSERT INTO public.wallets (user_id, balance, held_balance)
    VALUES (NEW.id, 0.00, 0.00)
    ON CONFLICT (user_id) DO NOTHING;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Trigger sobre la tabla profiles
DROP TRIGGER IF EXISTS tr_auto_provision_wallet ON public.profiles;
CREATE TRIGGER tr_auto_provision_wallet
AFTER INSERT ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.provision_wallet_for_profile();

-- 3. Asegurar que los perfiles existentes tengan su wallet (Backfill)
INSERT INTO public.wallets (user_id, balance, held_balance)
SELECT id, 0.00, 0.00 FROM public.profiles
ON CONFLICT (user_id) DO NOTHING;

-- 4. Actualizar handle_new_user para que sea más limpio (opcional, pero recomendado)
-- Ahora handle_new_user solo necesita insertar en profiles, y el trigger de profiles se encarga del resto.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, email, full_name, photo_url)
    VALUES (
        new.id,
        new.email,
        COALESCE(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
        COALESCE(new.raw_user_meta_data->>'avatar_url', 'https://api.dicebear.com/7.x/avataaars/svg?seed=' || new.id)
    );
    -- No insertamos en wallets aquí, dejamos que el trigger tr_auto_provision_wallet lo haga.
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
