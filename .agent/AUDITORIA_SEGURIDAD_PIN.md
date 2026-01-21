# 🕵️‍♂️ AUDITORÍA DE SEGURIDAD: Sistema de Verificación y PIN

**Fecha:** 12 de Enero de 2026
**Sistema Auditado:** Flujo de Reserva, Generación de PIN y Verificación de Viaje en Shareway.

---

## 🚨 RESUMEN DE HALLAZGOS CRÍTICOS

Se han identificado **vulnerabilidades de seguridad severas** que comprometen la integridad de los viajes y la privacidad de los usuarios. La más crítica es la exposición pública de los PINs de seguridad.

| Riesgo | Nivel | Descripción |
| :--- | :---: | :--- |
| **Exposición de PINs** | 🔴 **CRÍTICO** | Cualquier usuario autenticado puede ver los PINs de todos los pasajeros de cualquier viaje activo. |
| **Fuerza Bruta** | 🟠 **ALTO** | No existe restricción de intentos al verificar un PIN. |
| **Validación Débil** | 🟡 **MEDIO** | El sistema de generación de PIN es predecible y no criptográficamente seguro. |

---

## 🔍 ANÁLISIS DETALLADO

### 1. Generación y Almacenamiento del PIN

*   **Implementación Actual:**
    *   Se genera usando `LPAD(FLOOR(RANDOM() * 9000 + 1000)::TEXT, 4, '0')` dentro de `confirm_trip_and_pay`.
    *   Se almacena en texto plano dentro de la columna `passengers` (tipo JSONB) en la tabla `rides`.
*   **Vulnerabilidad:**
    *   La tabla `rides` tiene una política RLS pública: `CREATE POLICY "Anyone can view rides" ON public.rides FOR SELECT USING (true);`.
    *   **Consecuencia:** Si un atacante consulta la tabla `rides` (via API o cliente modificado), obtiene el objeto JSON completo, incluyendo el campo `pin` de cada pasajero.

### 2. Proceso de Verificación

*   **Implementación Actual:**
    *   Función `verify_passenger(p_pin TEXT)`.
    *   Compara el PIN recibido con el valor almacenado en el JSON.
*   **Vulnerabilidad:**
    *   No hay rate-limiting. Un conductor (o alguien suplantándolo) podría probar los 10,000 PINs en minutos mediante un script, forzando la verificación de un pasajero que no está presente.

### 3. Escenarios de Ataque (Exploits)

#### 🛑 A. Robo de Viaje (Suplantación de Pasajero)
1.  Atacante ve un viaje activo en la plataforma.
2.  Consulta la API de Supabase para obtener los detalles del viaje (`SELECT * FROM rides WHERE id = ...`).
3.  Obtiene el PIN de un pasajero legítimo del JSON `passengers`.
4.  Se presenta al conductor y le da el PIN correcto.
5.  El conductor valida y lleva al atacante. El pasajero real se queda en tierra y se le cobra.

#### 🛑 B. Fraude de Conductor (Viajes Fantasma)
1.  Conductor crea un viaje.
2.  Usa una cuenta secundaria (o cómplice) para reservar.
3.  Obtiene el PIN de la cuenta secundaria (ya que es público o porque es su cómplice).
4.  Verifica el PIN sin realizar el viaje.
5.  El sistema marca el viaje como completado y libera el pago.

---

## 🛡️ SOLUCIONES PROPUESTAS

### ✅ 1. Normalización de Datos (Solución Definitiva)

Mover los pasajeros fuera de la columna JSONB a una tabla propia con RLS estricto.

**Nueva Estructura:**
Crear tabla `ride_passengers`:
*   `ride_id` (FK)
*   `user_id` (FK)
*   `pin` (Solo visible por `user_id` o el sistema interno)
*   `status`
*   `is_verified`

**Política RLS para `ride_passengers`:**
*   `SELECT`: Solo permitir `auth.uid() = user_id`.

**Impacto:** El PIN ya no viaja en el objeto público del viaje.

### ✅ 2. Ocultamiento de PIN (Solución Rápida)

Si no se puede normalizar la base de datos inmediatamente:

1.  **RPC Seguro para Lectura:** Crear una función `get_ride_public_details(ride_id)` que devuelva el JSON de pasajeros **sin el campo PIN**.
2.  **Bloquear SELECT Directo:** Cambiar la política RLS de `rides` para restringir el acceso directo o forzar el uso del RPC seguro.
3.  **RPC "Ver mi PIN":** Crear una función `get_my_ride_pin(ride_id)` que solo devuelva el PIN si el usuario que llama es el dueño del asiento.

### ✅ 3. Fortalecimiento de Verificación

1.  **Rate Limiting:** Añadir un contador de intentos fallidos en la tabla `ride_passengers` (o caché Redis). Bloquear verificación tras 3-5 intentos.
2.  **Hashing:** Almacenar el PIN como un hash (bcrypt/argon2) en la base de datos.
    *   *Desafío:* El usuario necesita ver su PIN original. Esto requeriría generar el PIN, mostrarlo una vez y guardarlo hasheado, o encriptarlo reversiblemente (AES) con una clave del servidor. Dado que el pasajero necesita consultarlo varias veces, la encriptación o una tabla separada protegida es mejor que el hashing.

---

## 📝 PLAN DE ACCIÓN RECOMENDADO

1.  **Inmediato:** Implementar un **RPC Seguro** para obtener detalles del viaje que limpie el campo `pin` del JSON de pasajeros antes de enviarlo al frontend.
2.  **Frontend:** Actualizar `RideDetails.jsx` para usar este RPC seguro en lugar de `supabase.from('rides').select('*')`.
3.  **Endpoint PIN:** Crear un pequeño RPC `get_my_pin` para que el pasajero pueda ver *su* PIN de forma segura cuando lo necesite.

¿Deseas proceder con la implementación de estas correcciones de seguridad?
