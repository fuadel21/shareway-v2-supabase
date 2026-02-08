# 🔧 Fix: Error "column id does not exist" al Aceptar Solicitud

## Problema Identificado

Después de aplicar el primer fix, ahora aparece un nuevo error al intentar aceptar una solicitud de viaje:

```
Error al aceptar solicitud
column "id" does not exist
```

### Causa Raíz

La función `fulfill_ride_request` está intentando actualizar una columna `updated_at` que NO existe en la tabla `ride_requests`.

**Tabla `ride_requests` actual:**
- ✅ `created_at` - Existe
- ❌ `updated_at` - **NO EXISTE**

**Función intentando hacer:**
```sql
UPDATE public.ride_requests
SET status = 'accepted',
    matched_ride_id = v_ride_id,
    updated_at = NOW()  -- ❌ Esta columna no existe
WHERE id = p_request_id;
```

## Solución

### Aplicar SQL en Supabase

1. **Abre el SQL Editor de Supabase:**
   - Ve a https://supabase.com/dashboard
   - Selecciona tu proyecto
   - Ve a "SQL Editor"

2. **Copia y pega el contenido del archivo:**
   `supabase/FIX_FULFILL_RIDE_REQUEST_UPDATED_AT.sql`

3. **Ejecuta el script** haciendo clic en "Run"

4. **Verifica que se ejecutó correctamente:**
   - Deberías ver el mensaje: `✅ Function fulfill_ride_request updated successfully`

## Cambios Realizados

El archivo `FIX_FULFILL_RIDE_REQUEST_UPDATED_AT.sql` hace lo siguiente:

### 1. Agrega la columna `updated_at` a la tabla `ride_requests`
```sql
ALTER TABLE public.ride_requests 
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
```

### 2. Crea un trigger para auto-actualizar `updated_at`
Cada vez que se actualice un registro en `ride_requests`, el campo `updated_at` se actualizará automáticamente.

### 3. Actualiza la función `fulfill_ride_request`
- Acepta todos los parámetros que el frontend envía (incluyendo `p_details` y `p_overview_polyline`)
- Valida que el conductor no pueda aceptar su propia solicitud
- Crea el viaje correctamente
- Reserva automáticamente una plaza para el pasajero que hizo la solicitud
- Maneja errores apropiadamente

## Verificación

Después de aplicar el fix:

1. Ve a "Buscar" o "Dashboard"
2. Encuentra una solicitud de viaje pendiente
3. Haz clic en la solicitud para ver los detalles
4. Haz clic en "ACEPTAR SOLICITUD"
5. Introduce un precio
6. Confirma

**Resultado esperado:** 
- ✅ El viaje se crea exitosamente
- ✅ La solicitud se marca como "accepted"
- ✅ El pasajero obtiene automáticamente una plaza reservada
- ✅ Eres redirigido a "Mis Viajes"

## Archivos Modificados

- ✅ `supabase/FIX_FULFILL_RIDE_REQUEST_UPDATED_AT.sql` (NUEVO)

## Archivos Relacionados

- `src/components/RequestDetails.jsx` - Componente que muestra detalles de solicitud
- `src/services/rideService.js` - Servicio que llama a fulfillRequest
- `src/lib/supabaseRPC.js` - Wrapper RPC que llama a fulfill_ride_request

## Mejoras Adicionales

Esta actualización también incluye:

- **Auto-reserva:** Cuando un conductor acepta una solicitud, el pasajero automáticamente obtiene una plaza reservada
- **Validación de seguridad:** No se puede aceptar la propia solicitud
- **Bloqueo de fila:** Previene condiciones de carrera (race conditions)
- **Mejor manejo de errores:** Mensajes de error más claros

## Orden de Aplicación

Si aún no has aplicado el primer fix, debes aplicarlos en este orden:

1. **Primero:** `FIX_CREATE_RIDE_REQUEST_PARAMS.sql`
2. **Segundo:** `FIX_FULFILL_RIDE_REQUEST_UPDATED_AT.sql` (este archivo)

## Notas Técnicas

- La columna `updated_at` ahora se actualiza automáticamente mediante un trigger
- La función mantiene todas las validaciones de seguridad
- Se agregó validación para prevenir que un usuario acepte su propia solicitud
- La función ahora maneja correctamente el parámetro `p_overview_polyline` que faltaba
