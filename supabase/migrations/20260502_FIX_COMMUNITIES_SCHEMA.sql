-- ========================================================
-- SHAREWAY ELITE: ACTUALIZACIÓN DE ESQUEMA DE COMUNIDADES
-- Propósito: Añadir columnas necesarias para la gestión "Elite"
-- y corregir errores de inserción (400 Bad Request).
-- ========================================================

DO $$
BEGIN
    -- 1. Añadir descripción
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE table_name = 'communities' AND column_name = 'description') THEN
        ALTER TABLE public.communities ADD COLUMN description TEXT;
    END IF;

    -- 2. Añadir ubicación
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE table_name = 'communities' AND column_name = 'location') THEN
        ALTER TABLE public.communities ADD COLUMN location TEXT;
    END IF;

    -- 3. Añadir privacidad
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE table_name = 'communities' AND column_name = 'is_private') THEN
        ALTER TABLE public.communities ADD COLUMN is_private BOOLEAN DEFAULT false;
    END IF;

    -- 4. Añadir Admin ID (Referencia a perfiles)
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE table_name = 'communities' AND column_name = 'admin_id') THEN
        ALTER TABLE public.communities ADD COLUMN admin_id UUID REFERENCES public.profiles(id);
    END IF;

    -- 5. Añadir Banner URL
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE table_name = 'communities' AND column_name = 'banner_url') THEN
        ALTER TABLE public.communities ADD COLUMN banner_url TEXT;
    END IF;

    -- 6. Hacer allowed_domain opcional (para comunidades físicas sin email corporativo)
    ALTER TABLE public.communities ALTER COLUMN allowed_domain DROP NOT NULL;

END $$;

-- Asegurar RLS
ALTER TABLE public.communities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Communities are public" ON public.communities;
CREATE POLICY "Communities are public" ON public.communities
FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admins manage their communities" ON public.communities;
CREATE POLICY "Admins manage their communities" ON public.communities
FOR ALL USING (auth.uid() = admin_id OR public.is_admin(auth.uid()));

-- Permitir a usuarios autenticados crear comunidades
DROP POLICY IF EXISTS "Users can create communities" ON public.communities;
CREATE POLICY "Users can create communities" ON public.communities
FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
