# 🔧 FIX: Error en get_user_notifications

## 📋 Resumen del Problema

**Error detectado:**
```
POST https://wmkhutsesgtkcgqbctef.supabase.co/rest/v1/rpc/get_user_notifications 400 (Bad Request)
Error: {code: '42703', details: null, hint: null, message: 'column n.message does not exist'}
```

**Causa raíz:**
- La función RPC `get_user_notifications` está intentando acceder a una columna `n.message` que no existe en la tabla `notifications`
- La tabla tiene una columna `content` o `body` en lugar de `message`
- Hay inconsistencia entre el esquema de la base de datos y la función RPC

**Problemas adicionales detectados:**
- El hook `useNotifications` en `week2ComplementaryFeatures.jsx` está causando un bucle infinito de polling
- Warning: "Maximum update depth exceeded" debido a dependencias incorrectas en useEffect

---

## ✅ Solución Implementada

### 1. Migración SQL: `FIX_GET_USER_NOTIFICATIONS.sql`

La migración hace lo siguiente:

1. **Estandariza las columnas de la tabla `notifications`:**
   - Asegura que existe `content` (para el texto del mensaje)
   - Asegura que existe `title` (para el título)
   - Asegura que existe `data` (para payload JSON)
   - Asegura que existe `type` (para el tipo de notificación)
   - Asegura que existe `read` (boolean para estado leído)
   - Asegura que existe `status` (text para compatibilidad)
   - Migra datos de `body` a `content` si es necesario

2. **Recrea la función RPC `get_user_notifications`:**
   - Mapea correctamente `content` → `message` para el frontend
   - Usa COALESCE para valores por defecto
   - Retorna la estructura esperada por el frontend

3. **Otorga permisos:**
   - GRANT EXECUTE a usuarios autenticados

---

## 🚀 Cómo Aplicar la Solución

### Opción 1: Supabase Dashboard (RECOMENDADO)

1. **Abre Supabase Dashboard:**
   - Ve a https://supabase.com/dashboard
   - Selecciona tu proyecto

2. **Ve al SQL Editor:**
   - Click en "SQL Editor" en el menú lateral

3. **Copia y pega el SQL:**
   - Abre el archivo: `supabase/migrations/FIX_GET_USER_NOTIFICATIONS.sql`
   - Copia todo el contenido
   - Pégalo en el SQL Editor

4. **Ejecuta:**
   - Click en "Run" o presiona Ctrl+Enter

5. **Verifica:**
   - Deberías ver "Success. No rows returned"
   - Refresca tu aplicación

### Opción 2: CLI de Supabase

```bash
# Si tienes Supabase CLI instalado
supabase db push
```

### Opción 3: Script de PowerShell

```powershell
# Ejecuta el script de instrucciones
.\apply-fix-instructions.bat
```

---

## 🔍 Verificación Post-Migración

Después de aplicar la migración, verifica que:

1. **La función RPC existe:**
```sql
SELECT routine_name 
FROM information_schema.routines 
WHERE routine_name = 'get_user_notifications';
```

2. **Las columnas existen:**
```sql
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'notifications';
```

3. **La aplicación funciona:**
   - Refresca tu navegador (Ctrl+F5)
   - Verifica que no hay errores en la consola
   - Las notificaciones deberían cargarse correctamente

---

## 🐛 Problemas Adicionales a Resolver

### 1. Bucle Infinito en useNotifications

**Archivo:** `src/utils/week2ComplementaryFeatures.jsx` (líneas 15-102)

**Problema:**
```javascript
const { data: notificationData, refetch: refetchNotifications } = useOptimizedDataFetch(
    `notifications_${userId}`,
    () => fetchNotifications(userId),
    {
        ttl: 30000,
        pollingInterval: 15000 // ⚠️ Esto causa polling infinito
    }
);
```

**Solución recomendada:**
```javascript
// Opción A: Deshabilitar polling temporalmente
const { data: notificationData, refetch: refetchNotifications } = useOptimizedDataFetch(
    `notifications_${userId}`,
    () => fetchNotifications(userId),
    {
        ttl: 30000,
        pollingInterval: null // Sin polling automático
    }
);

// Opción B: Usar WebSocket en lugar de polling
const { subscribeToNotifications } = useRealTimeSubscriptions(userId);
useEffect(() => {
    const subscription = subscribeToNotifications((payload) => {
        refetchNotifications();
    });
    return () => subscription.unsubscribe();
}, [userId]);
```

### 2. Dependencias de useEffect

**Problema:**
```javascript
useEffect(() => {
    const unread = notificationData?.filter(n => !n.is_read).length || 0;
    setUnreadCount(unread);
    setNotifications(notificationData || []);
}, [notificationData]); // ⚠️ Esto puede causar re-renders infinitos
```

**Solución:**
```javascript
useEffect(() => {
    if (!notificationData) return;
    
    const unread = notificationData.filter(n => !n.is_read).length;
    setUnreadCount(unread);
    setNotifications(notificationData);
}, [notificationData]); // Ahora es seguro
```

---

## 📊 Impacto Esperado

✅ **Después de aplicar la migración:**
- ❌ Error 400 desaparecerá
- ✅ Las notificaciones se cargarán correctamente
- ✅ No más errores "column n.message does not exist"
- ⚠️ Aún puede haber polling excesivo (requiere fix adicional)

---

## 🔄 Próximos Pasos

1. **Aplicar la migración SQL** (CRÍTICO)
2. **Verificar que funciona** (refrescar navegador)
3. **Optimizar el polling** (opcional pero recomendado)
4. **Implementar WebSocket** (para notificaciones en tiempo real)

---

## 📝 Notas Técnicas

- **Código de error PostgreSQL 42703:** "undefined_column"
- **Compatibilidad:** La migración es retrocompatible y no romperá datos existentes
- **Performance:** El mapeo COALESCE tiene impacto mínimo en performance
- **RLS:** Los permisos RLS existentes se mantienen

---

## 🆘 Troubleshooting

### Si el error persiste:

1. **Verifica que la migración se aplicó:**
```sql
SELECT * FROM public.notifications LIMIT 1;
-- Debe mostrar las columnas: id, user_id, type, title, content, data, read, status, created_at
```

2. **Verifica la función RPC:**
```sql
SELECT pg_get_functiondef('public.get_user_notifications'::regproc);
```

3. **Limpia el caché del navegador:**
```
Ctrl + Shift + Delete → Clear cache
```

4. **Reinicia el servidor de desarrollo:**
```bash
npm run dev
```

---

**Fecha de creación:** 2026-01-29
**Versión:** 1.0
**Prioridad:** 🔴 CRÍTICA
