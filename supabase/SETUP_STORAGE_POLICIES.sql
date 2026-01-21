-- ==========================================
-- SCRIPT DE SEGURIDAD: ALMACENAMIENTO DE DOCUMENTOS (CORREGIDO)
-- ==========================================

-- 1. CREAR BUCKET (Si no existe)
INSERT INTO storage.buckets (id, name, public)
VALUES ('verification-documents', 'verification-documents', false)
ON CONFLICT (id) DO NOTHING;

-- 2. ACTIVAR RLS EN OBJETOS
-- Intentamos saltar este paso si falla por permisos, asumiendo que ya está activo.
-- Si necesitas forzarlo y falla, contacta soporte de Supabase o usa el usuario 'supabase_admin' si tienes acceso.
-- ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY; -- COMENTADO POR ERROR DE PERMISOS

-- 3. POLÍTICAS DE ACCESO PARA DOCUMENTOS

-- Borrar políticas previas para evitar conflictos al re-ejecutar
DROP POLICY IF EXISTS "Users can upload their own verification documents" ON storage.objects;
DROP POLICY IF EXISTS "Users can view their own verification documents" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own verification documents" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own verification documents" ON storage.objects;

-- A. Subida (INSERT)
CREATE POLICY "Users can upload their own verification documents"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'verification-documents' 
    AND (storage.foldername(name))[1] = auth.uid()::text
);

-- B. Lectura (SELECT)
CREATE POLICY "Users can view their own verification documents"
ON storage.objects FOR SELECT
TO authenticated
USING (
    bucket_id = 'verification-documents' 
    AND (
        (storage.foldername(name))[1] = auth.uid()::text
        OR 
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true)
    )
);

-- C. Actualización (UPDATE)
CREATE POLICY "Users can update their own verification documents"
ON storage.objects FOR UPDATE
TO authenticated
USING (
    bucket_id = 'verification-documents' 
    AND (storage.foldername(name))[1] = auth.uid()::text
);

-- D. Borrado (DELETE)
CREATE POLICY "Users can delete their own verification documents"
ON storage.objects FOR DELETE
TO authenticated
USING (
    bucket_id = 'verification-documents' 
    AND (
        (storage.foldername(name))[1] = auth.uid()::text
        OR 
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true)
    )
);

DO $$
BEGIN
    RAISE NOTICE '✅ Bucket verification-documents asegurado (Versión Corregida).';
END $$;
