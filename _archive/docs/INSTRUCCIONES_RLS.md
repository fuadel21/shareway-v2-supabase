# Instrucciones para Aplicar Políticas RLS en Supabase

## Problema
La aplicación se queda cargando infinitamente después de iniciar sesión porque las tablas tienen Row Level Security (RLS) habilitado pero no tienen políticas que permitan a los usuarios acceder a sus datos.

## Solución
Necesitas ejecutar el archivo `supabase/rls_policies.sql` en tu base de datos de Supabase.

## Pasos para Aplicar las Políticas

### Opción 1: Desde el Dashboard de Supabase (Recomendado)

1. Ve a https://supabase.com/dashboard
2. Selecciona tu proyecto: **wmkhutsesgtkcgqbctef**
3. En el menú lateral, haz clic en **"SQL Editor"**
4. Haz clic en **"New query"**
5. Copia todo el contenido del archivo `c:\shareway v2 supabase\supabase\rls_policies.sql`
6. Pégalo en el editor SQL
7. Haz clic en **"Run"** o presiona `Ctrl+Enter`
8. Verifica que todas las políticas se hayan creado correctamente (deberías ver mensajes de éxito)

### Opción 2: Usando psql (Si tienes PostgreSQL instalado)

```bash
# Desde la terminal en el directorio del proyecto
psql "postgresql://postgres:[TU_PASSWORD]@db.wmkhutsesgtkcgqbctef.supabase.co:5432/postgres" < supabase/rls_policies.sql
```

## Verificación

Después de aplicar las políticas, prueba lo siguiente:

1. Recarga la aplicación en el navegador (F5)
2. Intenta registrarte con un nuevo usuario
3. Verifica que después del registro, la aplicación te redirija al dashboard correctamente
4. Si ya tienes un usuario creado, intenta iniciar sesión

## Políticas Creadas

El script crea políticas para las siguientes tablas:
- ✅ `profiles` - Permite a los usuarios ver todos los perfiles y editar el suyo
- ✅ `wallets` - Permite a los usuarios ver y gestionar su wallet
- ✅ `transactions` - Permite a los usuarios ver sus transacciones
- ✅ `rides` - Permite a todos ver viajes y a los conductores gestionar los suyos
- ✅ `ride_requests` - Permite a los usuarios gestionar sus solicitudes
- ✅ `favorite_routes` - Permite a los usuarios gestionar sus rutas favoritas
- ✅ `emergency_contacts` - Permite a los usuarios gestionar sus contactos de emergencia
- ✅ `chats` - Permite a los participantes ver y gestionar sus chats
- ✅ `messages` - Permite a los participantes enviar y ver mensajes
- ✅ `reviews` - Permite a todos ver reseñas y a los usuarios crear las suyas
- ✅ `communities` - Permite a todos ver comunidades y a los admins gestionarlas

## Notas Importantes

- **Seguridad**: Estas políticas están diseñadas para ser seguras y solo permitir que los usuarios accedan a sus propios datos
- **Rendimiento**: Las políticas RLS se ejecutan en el servidor de base de datos, por lo que son muy eficientes
- **Trigger**: El trigger `on_auth_user_created` debería crear automáticamente el perfil y wallet para nuevos usuarios, pero por si acaso, el código de la aplicación también lo hace

## Si Sigues Teniendo Problemas

Si después de aplicar las políticas sigues teniendo el problema de carga infinita:

1. Abre la consola del navegador (F12)
2. Ve a la pestaña "Console"
3. Busca mensajes de error relacionados con Supabase
4. Comparte esos errores para poder ayudarte mejor

## Contacto

Si necesitas ayuda adicional, puedes:
- Revisar la documentación de Supabase RLS: https://supabase.com/docs/guides/auth/row-level-security
- Verificar que el trigger `on_auth_user_created` esté activo en tu base de datos
