-- ==========================================
-- 20260510_REPUTATION_HISTORY_SYSTEM.sql
-- Sistema de Auditoría de Reputación y Trust Score
-- ==========================================

-- 1. Tabla de Historial de Reputación
CREATE TABLE IF NOT EXISTS public.reputation_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    change_type TEXT NOT NULL, -- 'trust_score', 'rating'
    amount NUMERIC NOT NULL,   -- Valor del cambio (positivo o negativo)
    new_value NUMERIC NOT NULL, -- Valor resultante después del cambio
    reason TEXT,               -- Motivo del cambio
    related_ride_id UUID REFERENCES public.rides(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS
ALTER TABLE public.reputation_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view their own reputation history" ON public.reputation_history;
CREATE POLICY "Users can view their own reputation history"
    ON public.reputation_history FOR SELECT
    USING (auth.uid() = user_id);

-- 2. Función Helper para registrar cambios (Uso interno)
CREATE OR REPLACE FUNCTION public.log_reputation_change(
    p_user_id UUID,
    p_type TEXT,
    p_amount NUMERIC,
    p_new_value NUMERIC,
    p_reason TEXT,
    p_ride_id UUID DEFAULT NULL
) RETURNS VOID AS $$
BEGIN
    INSERT INTO public.reputation_history (user_id, change_type, amount, new_value, reason, related_ride_id)
    VALUES (p_user_id, p_type, p_amount, p_new_value, p_reason, p_ride_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. RPC para obtener el historial del usuario (Frontend)
CREATE OR REPLACE FUNCTION public.get_my_reputation_history(p_limit INTEGER DEFAULT 20)
RETURNS JSONB AS $$
DECLARE
    v_history JSONB;
BEGIN
    SELECT jsonb_agg(h) INTO v_history
    FROM (
        SELECT * FROM public.reputation_history
        WHERE user_id = auth.uid()
        ORDER BY created_at DESC
        LIMIT p_limit
    ) h;

    RETURN COALESCE(v_history, '[]'::jsonb);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
