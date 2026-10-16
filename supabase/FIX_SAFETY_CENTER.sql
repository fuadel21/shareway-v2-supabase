-- ============================================================================
-- SHAREWAY · FIX_SAFETY_CENTER.sql
-- ============================================================================
-- Completa el Centro de Seguridad:
--   1) Caja Negra de Audio: tabla safety_evidence + bucket privado
--      'safety-vault' con politicas de storage (antes NO existian → grabar
--      audio fallaba siempre)
--   2) get_my_safety_history: ahora muestra tambien las grabaciones (union
--      de alertas SOS + evidencias de audio), con duracion y ruta
-- Es IDEMPOTENTE. Ejecutar entero en el SQL Editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Tabla de evidencias de seguridad
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.safety_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  ride_id UUID REFERENCES public.rides(id) ON DELETE SET NULL,
  evidence_type TEXT NOT NULL DEFAULT 'audio_recording',
  file_path TEXT NOT NULL,
  metadata JSONB DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_safety_evidence_user ON public.safety_evidence (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_safety_evidence_ride ON public.safety_evidence (ride_id);

ALTER TABLE public.safety_evidence ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "safety_evidence_select_own" ON public.safety_evidence;
CREATE POLICY "safety_evidence_select_own"
ON public.safety_evidence FOR SELECT TO authenticated
USING (user_id = auth.uid());

DROP POLICY IF EXISTS "safety_evidence_insert_own" ON public.safety_evidence;
CREATE POLICY "safety_evidence_insert_own"
ON public.safety_evidence FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid());

-- Sin UPDATE ni DELETE directos: la evidencia es inmutable para el usuario.

-- ----------------------------------------------------------------------------
-- 2) Bucket privado de audio (Caja Negra)
-- ----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('safety-vault', 'safety-vault', FALSE, 26214400,
        ARRAY['audio/webm','audio/mp4','audio/mpeg','audio/ogg','audio/wav','audio/x-m4a'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "safety_vault_upload_own" ON storage.objects;
CREATE POLICY "safety_vault_upload_own"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'safety-vault' AND owner = auth.uid());

DROP POLICY IF EXISTS "safety_vault_read_own" ON storage.objects;
CREATE POLICY "safety_vault_read_own"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'safety-vault' AND owner = auth.uid());

-- Sin UPDATE/DELETE: lo que entra a la bóveda no se manipula ni se borra
-- desde el cliente.

-- ----------------------------------------------------------------------------
-- 3) Historial de seguridad unificado (alertas SOS + grabaciones)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_safety_history()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT COALESCE((
    WITH alerts AS (
      SELECT jsonb_build_object(
        'id', a.id,
        'evidence_type', COALESCE(a.metadata->>'type', a.metadata->>'evidence_type', 'sos_alert'),
        'status', a.status,
        'severity', a.severity,
        'created_at', a.created_at,
        'ride_id', a.ride_id,
        'origin_name', COALESCE(a.ride_snapshot->'origin'->>'name', a.ride_snapshot->'origin'->>'address'),
        'destination_name', COALESCE(a.ride_snapshot->'destination'->>'name', a.ride_snapshot->'destination'->>'address'),
        'metadata', a.metadata
      ) AS item, a.created_at
      FROM public.emergency_alerts a
      WHERE a.user_id = auth.uid()
    ), evidence AS (
      SELECT jsonb_build_object(
        'id', e.id,
        'evidence_type', 'audio_recording',
        'status', 'stored',
        'severity', NULL,
        'created_at', e.created_at,
        'ride_id', e.ride_id,
        'origin_name', NULL,
        'destination_name', NULL,
        'metadata', COALESCE(e.metadata, '{}'::JSONB)
          || jsonb_build_object('file_path', e.file_path)
      ) AS item, e.created_at
      FROM public.safety_evidence e
      WHERE e.user_id = auth.uid()
    )
    SELECT jsonb_agg(item ORDER BY created_at DESC)
    FROM (
      SELECT item, created_at FROM alerts
      UNION ALL
      SELECT item, created_at FROM evidence
    ) unioned
  ), '[]'::JSONB);
$fn$;

REVOKE ALL ON FUNCTION public.get_my_safety_history() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_safety_history() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_safety_history() TO authenticated;

NOTIFY pgrst, 'reload schema';
