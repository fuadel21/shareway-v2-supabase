@echo off
echo ========================================
echo INSTRUCCIONES PARA APLICAR LA MIGRACION
echo ========================================
echo.
echo 1. Abre Supabase Dashboard en tu navegador
echo 2. Ve a SQL Editor
echo 3. Copia y pega el siguiente SQL:
echo.
echo ----------------------------------------
type "supabase\migrations\FIX_GET_USER_NOTIFICATIONS.sql"
echo ----------------------------------------
echo.
echo 4. Ejecuta el SQL
echo 5. Refresca tu aplicacion
echo.
pause
