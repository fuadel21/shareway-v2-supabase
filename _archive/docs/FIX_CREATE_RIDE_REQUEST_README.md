# 🔧 Fix: Error en create_ride_request

## Problema Identificado

La aplicación está mostrando el siguiente error al intentar crear una solicitud de viaje:

```
Error: Could not find the function
public.create_ride_requests_departure_time, p_datetime, p_datetime, p_default, p_origin, 
p_owner_or_polyline, p_a_woman_only, p_origin, p_departure, p_a_woman_only, p_updated_price 
in the schema 'cache'
```

### Causa Raíz

El frontend está llamando a la función `create_ride_request` con parámetros que la función de base de datos NO acepta:

**Frontend envía:**
- `p_origin` ✅
- `p_destination` ✅
- `p_departure_time` ✅
- `p_seats_needed` ✅
- `p_suggested_price` ✅
- `p_details` ✅
- `p_is_women_only` ✅
- `p_distance` ❌ **NO EXISTE EN LA FUNCIÓN**
- `p_overview_polyline` ❌ **NO EXISTE EN LA FUNCIÓN**

**Función actual acepta:**
- Solo los primeros 7 parámetros

## Solución

### Opción 1: Aplicar SQL directamente en Supabase (RECOMENDADO)

1. **Abre el SQL Editor de Supabase:**
   - Ve a https://supabase.com/dashboard
   - Selecciona tu proyecto
   - Ve a "SQL Editor" en el menú lateral

2. **Copia y pega el contenido del archivo:**
   `supabase/FIX_CREATE_RIDE_REQUEST_PARAMS.sql`

3. **Ejecuta el script** haciendo clic en "Run"

4. **Verifica que se ejecutó correctamente:**
   - Deberías ver el mensaje: `✅ Function create_ride_request updated successfully with new parameters`

### Opción 2: Usar el script de migración (Alternativa)

Si prefieres usar el script automatizado:

```bash
# Asegúrate de tener las variables de entorno configuradas
node apply-migrations.js --env=development
```

## Cambios Realizados

El archivo `FIX_CREATE_RIDE_REQUEST_PARAMS.sql` hace lo siguiente:

1. **Agrega columnas faltantes a la tabla `ride_requests`:**
   - `distance` (DECIMAL)
   - `overview_polyline` (TEXT)
   - `note` (TEXT)

2. **Actualiza la función `create_ride_request`** para aceptar los nuevos parámetros:
   - `p_distance DECIMAL DEFAULT NULL`
   - `p_overview_polyline TEXT DEFAULT NULL`

3. **Inserta los nuevos campos** en la tabla cuando se crea una solicitud

## Verificación

Después de aplicar el fix, prueba crear una nueva solicitud de viaje desde la interfaz:

1. Ve a "Pedir Plaza"
2. Selecciona origen y destino
3. Configura fecha, hora, asientos y precio
4. Haz clic en "PUBLICAR SOLICITUD"

**Resultado esperado:** La solicitud se crea exitosamente sin errores.

## Archivos Modificados

- ✅ `supabase/FIX_CREATE_RIDE_REQUEST_PARAMS.sql` (NUEVO)

## Archivos Relacionados (NO modificados)

- `src/services/rideService.js` - Llama a la función con los parámetros correctos
- `src/components/CreateRequest.jsx` - Componente que crea solicitudes
- `supabase/rpc_functions.sql` - Contiene la definición original de la función

## Notas Técnicas

- La función mantiene todas las validaciones de seguridad existentes
- Los nuevos parámetros son opcionales (DEFAULT NULL) para mantener compatibilidad
- La tabla `ride_requests` ahora puede almacenar la distancia y la polilínea de la ruta
