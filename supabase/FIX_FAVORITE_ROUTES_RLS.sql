-- SOLUCIÓN AL ERROR: new row violates row-level security policy for table "favorite_routes"
-- Copia y pega este script en el Editor SQL de tu Dashboard de Supabase para arreglar los permisos.
-- 1. Asegurar que RLS está activo (por seguridad)
ALTER TABLE favorite_routes ENABLE ROW LEVEL SECURITY;
-- 2. Eliminar políticas antiguas si existen para evitar conflictos
DROP POLICY IF EXISTS "Users can insert their own favorite routes" ON favorite_routes;
DROP POLICY IF EXISTS "Users can view their own favorite routes" ON favorite_routes;
DROP POLICY IF EXISTS "Users can update their own favorite routes" ON favorite_routes;
DROP POLICY IF EXISTS "Users can delete their own favorite routes" ON favorite_routes;
-- 3. Crear políticas correctas
-- INSERT: Permite crear si el user_id coincide con tu usuario actual
CREATE POLICY "Users can insert their own favorite routes" ON favorite_routes FOR
INSERT WITH CHECK (auth.uid() = user_id);
-- SELECT: Permite ver SOLO tus rutas
CREATE POLICY "Users can view their own favorite routes" ON favorite_routes FOR
SELECT USING (auth.uid() = user_id);
-- UPDATE: Permite editar tus rutas
CREATE POLICY "Users can update their own favorite routes" ON favorite_routes FOR
UPDATE USING (auth.uid() = user_id);
-- DELETE: Permite borrar tus rutas
CREATE POLICY "Users can delete their own favorite routes" ON favorite_routes FOR DELETE USING (auth.uid() = user_id);