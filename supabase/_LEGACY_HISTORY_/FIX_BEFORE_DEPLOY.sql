-- ==========================================
-- SCRIPT DE CORRECCIÓN PRE-DESPLIEGUE
-- Ejecuta ESTE script ANTES de DEPLOY_DISPUTES_SYSTEM.sql
-- ==========================================

-- ==========================================
-- PASO 1: VERIFICAR Y AÑADIR COLUMNAS FALTANTES EN PROFILES
-- ==========================================

-- Añadir is_admin si no existe
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'profiles' 
        AND column_name = 'is_admin'
    ) THEN
        ALTER TABLE public.profiles ADD COLUMN is_admin BOOLEAN DEFAULT FALSE;
        RAISE NOTICE '✅ Columna is_admin añadida a profiles';
    ELSE
        RAISE NOTICE '✓ Columna is_admin ya existe';
    END IF;
END $$;

-- Añadir role si no existe
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'profiles' 
        AND column_name = 'role'
    ) THEN
        ALTER TABLE public.profiles ADD COLUMN role TEXT DEFAULT 'user' CHECK (role IN ('user', 'admin', 'driver'));
        RAISE NOTICE '✅ Columna role añadida a profiles';
    ELSE
        RAISE NOTICE '✓ Columna role ya existe';
    END IF;
END $$;

-- Añadir is_suspended si no existe
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'profiles' 
        AND column_name = 'is_suspended'
    ) THEN
        ALTER TABLE public.profiles ADD COLUMN is_suspended BOOLEAN DEFAULT FALSE;
        RAISE NOTICE '✅ Columna is_suspended añadida a profiles';
    ELSE
        RAISE NOTICE '✓ Columna is_suspended ya existe';
    END IF;
END $$;

-- Añadir suspension_until si no existe
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'profiles' 
        AND column_name = 'suspension_until'
    ) THEN
        ALTER TABLE public.profiles ADD COLUMN suspension_until TIMESTAMPTZ;
        RAISE NOTICE '✅ Columna suspension_until añadida a profiles';
    ELSE
        RAISE NOTICE '✓ Columna suspension_until ya existe';
    END IF;
END $$;

-- Añadir cancellation_count_30d si no existe
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'profiles' 
        AND column_name = 'cancellation_count_30d'
    ) THEN
        ALTER TABLE public.profiles ADD COLUMN cancellation_count_30d INTEGER DEFAULT 0;
        RAISE NOTICE '✅ Columna cancellation_count_30d añadida a profiles';
    ELSE
        RAISE NOTICE '✓ Columna cancellation_count_30d ya existe';
    END IF;
END $$;

-- Añadir last_cancellation_check si no existe
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'profiles' 
        AND column_name = 'last_cancellation_check'
    ) THEN
        ALTER TABLE public.profiles ADD COLUMN last_cancellation_check TIMESTAMPTZ DEFAULT NOW();
        RAISE NOTICE '✅ Columna last_cancellation_check añadida a profiles';
    ELSE
        RAISE NOTICE '✓ Columna last_cancellation_check ya existe';
    END IF;
END $$;

-- ==========================================
-- PASO 2: VERIFICAR TABLA RIDES
-- ==========================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'rides' 
        AND column_name = 'cancelled_at'
    ) THEN
        ALTER TABLE public.rides ADD COLUMN cancelled_at TIMESTAMPTZ;
        RAISE NOTICE '✅ Columna cancelled_at añadida a rides';
    ELSE
        RAISE NOTICE '✓ Columna cancelled_at ya existe';
    END IF;
END $$;

-- ==========================================
-- PASO 3: ASIGNAR ADMIN A TU USUARIO
-- ==========================================

-- IMPORTANTE: Reemplaza 'TU_EMAIL@example.com' con tu email real
DO $$
DECLARE
    v_user_id UUID;
BEGIN
    -- Buscar tu usuario por email
    SELECT id INTO v_user_id
    FROM public.profiles
    WHERE email = 'fuadel21@hotmail.com'  -- ⚠️ CAMBIA ESTO
    LIMIT 1;
    
    IF v_user_id IS NOT NULL THEN
        UPDATE public.profiles
        SET is_admin = true,
            role = 'admin'
        WHERE id = v_user_id;
        
        RAISE NOTICE '✅ Usuario configurado como administrador: %', v_user_id;
    ELSE
        RAISE NOTICE '⚠️  No se encontró usuario con ese email. Actualiza el script con tu email.';
    END IF;
END $$;

-- ==========================================
-- VERIFICACIÓN FINAL
-- ==========================================

DO $$
DECLARE
    v_column_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_column_count
    FROM information_schema.columns
    WHERE table_name = 'profiles'
    AND column_name IN (
        'is_admin',
        'role',
        'is_suspended',
        'suspension_until',
        'cancellation_count_30d',
        'last_cancellation_check'
    );
    
    IF v_column_count = 6 THEN
        RAISE NOTICE '';
        RAISE NOTICE '════════════════════════════════════════════════';
        RAISE NOTICE '✅ CORRECCIÓN COMPLETADA EXITOSAMENTE';
        RAISE NOTICE '════════════════════════════════════════════════';
        RAISE NOTICE '';
        RAISE NOTICE '✅ Todas las columnas necesarias están presentes';
        RAISE NOTICE '✅ Ahora puedes ejecutar DEPLOY_DISPUTES_SYSTEM.sql';
        RAISE NOTICE '';
    ELSE
        RAISE NOTICE '';
        RAISE NOTICE '⚠️  ADVERTENCIA: Solo % de 6 columnas encontradas', v_column_count;
        RAISE NOTICE '   Revisa los mensajes anteriores para ver qué falta';
        RAISE NOTICE '';
    END IF;
END $$;
