-- ==============================================================================
-- SHAREWAY ELITE: MOTOR DE BÓVEDA DE SEGURIDAD (SAFETY VAULT)
-- Proporciona un registro inmutable de evidencias (Audio, SOS, Fotos)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.safety_evidence (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ride_id UUID REFERENCES public.rides(id) ON DELETE SET NULL,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE DEFAULT auth.uid(),
    evidence_type TEXT NOT NULL, -- 'audio_recording', 'sos_alert', 'photo_check'
    file_path TEXT,              -- Ruta en Storage (bucket 'safety-vault')
    metadata JSONB DEFAULT '{}', -- {duration: 120, size: 2048, device_info: {}}
    status TEXT DEFAULT 'sealed', -- 'sealed' (sellado), 'opened' (bajo investigación), 'expired'
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 days') -- Purga automática tras 30 días
);

-- Habilitar RLS
ALTER TABLE public.safety_evidence ENABLE ROW LEVEL SECURITY;

-- POLÍTICAS: El usuario solo puede ver sus propias evidencias.
-- El sistema/admin puede ver todo.
CREATE POLICY "Users can view their own safety evidence"
    ON public.safety_evidence FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own safety evidence"
    ON public.safety_evidence FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- 2. FUNCIÓN PARA OBTENER HISTORIAL DE SEGURIDAD
CREATE OR REPLACE FUNCTION public.get_my_safety_history()
RETURNS TABLE (
    id UUID,
    ride_id UUID,
    evidence_type TEXT,
    file_path TEXT,
    metadata JSONB,
    status TEXT,
    created_at TIMESTAMPTZ,
    origin_name TEXT,
    destination_name TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        se.id,
        se.ride_id,
        se.evidence_type,
        se.file_path,
        se.metadata,
        se.status,
        se.created_at,
        (r.origin->>'name')::TEXT,
        (r.destination->>'name')::TEXT
    FROM public.safety_evidence se
    LEFT JOIN public.rides r ON se.ride_id = r.id
    WHERE se.user_id = auth.uid()
    ORDER BY se.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. BUCKET DE STORAGE (Asegurar que exista en la configuración de Supabase)
-- Nota: El bucket 'safety-vault' debe configurarse con políticas de escritura pública
-- pero lectura restringida a través de Supabase Dashboard o SQL si es posible.
