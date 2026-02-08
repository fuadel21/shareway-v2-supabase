-- SOLUCIÓN AL ERROR: Error al vincular guardián (Emergency Contacts RLS)
-- Copia y pega este script en el Editor SQL de tu Dashboard de Supabase.
-- 1. Asegurar que RLS está activo
ALTER TABLE emergency_contacts ENABLE ROW LEVEL SECURITY;
-- 2. Limpiar políticas antiguas para evitar duplicados/errores
DROP POLICY IF EXISTS "Users can insert their own emergency contacts" ON emergency_contacts;
DROP POLICY IF EXISTS "Users can view their own emergency contacts" ON emergency_contacts;
DROP POLICY IF EXISTS "Users can delete their own emergency contacts" ON emergency_contacts;
-- 3. Crear políticas correctas
-- INSERT
CREATE POLICY "Users can insert their own emergency contacts" ON emergency_contacts FOR
INSERT WITH CHECK (auth.uid() = user_id);
-- SELECT
CREATE POLICY "Users can view their own emergency contacts" ON emergency_contacts FOR
SELECT USING (auth.uid() = user_id);
-- DELETE
CREATE POLICY "Users can delete their own emergency contacts" ON emergency_contacts FOR DELETE USING (auth.uid() = user_id);