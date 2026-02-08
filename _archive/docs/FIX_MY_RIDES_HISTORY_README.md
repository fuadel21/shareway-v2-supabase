# 🔧 Fix: Viajes Cancelados No Aparecen en Historial

## Problema Identificado

En la pestaña "Mis Viajes", los viajes cancelados no se están filtrando correctamente hacia la sección de "Historial". Permanecen en "Próximos" o simplemente no aparecen.

### Causa Raíz

El componente `MyRides.jsx` está llamando a una función RPC `fetch_my_activity_v1` que **NO EXISTE** en la base de datos. Esto causa que:

1. La consulta falle silenciosamente
2. No se devuelvan los viajes cancelados
3. El historial aparezca vacío o incompleto

**Código del componente (línea 113):**
```javascript
const { data, error } = await supabase.rpc('fetch_my_activity_v1', { p_user_id: id });
```

**Problema:** Esta función no está definida en Supabase.

## Solución

### Aplicar SQL en Supabase

1. **Abre el SQL Editor de Supabase:**
   - Ve a https://supabase.com/dashboard
   - Selecciona tu proyecto
   - Ve a "SQL Editor"

2. **Copia y pega el contenido del archivo:**
   `supabase/FIX_MY_RIDES_HISTORY.sql`

3. **Ejecuta el script** haciendo clic en "Run"

4. **Verifica que se ejecutó correctamente:**
   - Deberías ver el mensaje: `✅ Function fetch_my_activity_v1 created successfully`

## ¿Qué Hace Este Fix?

### Crea la función `fetch_my_activity_v1`

Esta función devuelve **TODOS** los viajes del usuario, incluyendo:

- ✅ Viajes programados (`scheduled`)
- ✅ Viajes en curso (`active`, `in_progress`)
- ✅ Viajes completados (`completed`)
- ✅ **Viajes cancelados (`cancelled`)** ← **ESTO ES LO IMPORTANTE**
- ✅ Viajes expirados (`expired`)

### Lógica de Filtrado

La función devuelve viajes donde el usuario:
1. **Es el conductor** (`driver_id = p_user_id`)
2. **Es/fue pasajero** (`p_user_id = ANY(participant_ids)`)

Incluso si el viaje fue cancelado, el usuario seguirá en `participant_ids`, por lo que el viaje se devolverá correctamente.

### El Componente Hace el Resto

Una vez que la función devuelve todos los viajes, el componente `MyRides.jsx` se encarga de filtrarlos:

**Próximos:**
- Viajes con status `scheduled` o `active`
- Que no hayan pasado más de 2 horas desde la hora de salida

**Historial:**
- Viajes con status `completed`, `cancelled` o `expired`
- Viajes `scheduled` que ya pasaron hace más de 2 horas

## Verificación

Después de aplicar el fix:

### Test 1: Cancelar un Viaje
1. Ve a "Mis Viajes" → "Próximos"
2. Selecciona un viaje programado
3. Cancélalo
4. Vuelve a "Mis Viajes"
5. Cambia a la pestaña "Historial"
6. **Resultado esperado:** El viaje cancelado aparece en el historial con el badge "CANCELADO" en rojo

### Test 2: Ver Viajes Completados
1. Ve a "Mis Viajes" → "Historial"
2. **Resultado esperado:** Ves todos tus viajes pasados (completados, cancelados, expirados)

### Test 3: Filtrado Correcto
1. Ve a "Mis Viajes" → "Próximos"
2. **Resultado esperado:** Solo ves viajes futuros o en curso
3. Cambia a "Historial"
4. **Resultado esperado:** Solo ves viajes pasados, cancelados o completados

## Archivos Modificados

- ✅ `supabase/FIX_MY_RIDES_HISTORY.sql` (NUEVO)

## Archivos Relacionados (NO modificados)

- `src/components/MyRides.jsx` - Componente que muestra los viajes
- `supabase/rpc_functions.sql` - Contiene otras funciones RPC

## Badges de Estado

Después del fix, verás estos badges en tus viajes:

| Estado | Badge | Color | Ubicación |
|--------|-------|-------|-----------|
| `scheduled` | PROGRAMADO | Azul índigo | Próximos |
| `active` / `in_progress` | EN CURSO | Verde esmeralda (pulsante) | Próximos |
| `completed` | COMPLETADO | Gris | Historial |
| `cancelled` | **CANCELADO** | **Rojo** | **Historial** ✅ |
| `expired` | CADUCADO | Naranja | Historial |

## Orden de Aplicación de Fixes

Si estás aplicando múltiples fixes, este es el orden recomendado:

1. `FIX_CREATE_RIDE_REQUEST_PARAMS.sql` (Crear solicitudes)
2. `FIX_FULFILL_RIDE_REQUEST_UPDATED_AT.sql` (Aceptar solicitudes)
3. **`FIX_MY_RIDES_HISTORY.sql`** (Este fix - Historial de viajes)

## Notas Técnicas

- La función usa `SECURITY DEFINER` para ejecutarse con permisos elevados
- Está marcada como `STABLE` porque no modifica datos
- Ordena los resultados por `departure_time DESC` (más recientes primero)
- Incluye todos los campos necesarios para renderizar las tarjetas de viaje
- Es compatible con Row Level Security (RLS)

## Beneficios Adicionales

Este fix también mejora:

- **Transparencia:** Los usuarios pueden ver todos sus viajes históricos
- **Auditoría:** Registro completo de actividad del usuario
- **UX:** Separación clara entre viajes activos y pasados
- **Debugging:** Más fácil identificar problemas en el flujo de viajes
