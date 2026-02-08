# Auditoría Técnica Parte 2: Flujo "Pedir Plaza" y Consistencia
**Fecha:** 2026-01-13
**Auditor:** Senior Product Engineer & QA Lead
**Alcance:** `create_ride_request`, `accept_request`, `confirm_trip_and_pay`.

---

## 1. Vulnerabilidades Detectadas y Corregidas (Seguridad)

### 1.1. Inyección de Datos en Solicitudes
*   **Problema:** La función `create_ride_request` original permitía valores arbitrarios (ej. solicitar 100 asientos, precios negativos, spam masivo).
*   **Corrección (Aplicada en V2):**
    *   **Max Asientos:** Limitado a 8.
    *   **Rate Limiting:** Máx 5 solicitudes pendientes por usuario.
    *   **Precio Justo:** Validación heurística (Max ~1€/km) para evitar uso del sistema para fines ajenos al carsharing.

## 2. Análisis de Condiciones de Carrera (Race Conditions)

### 2.1. Reserva de Plazas (`confirm_trip_and_pay`)
*   **Estado:** ✅ **Seguro**.
*   **Evidencia:** El uso de `SELECT ... FOR UPDATE` en la tabla `rides` garantiza que las transacciones sean seriales.
*   **Escenario de Prueba:** Si 10 usuarios intentan pagar el último asiento simultáneamente:
    *   Usuario 1: Obtiene bloqueo -> Paga -> Asientos = 0.
    *   Usuario 2..10: Obtienen bloqueo (secuencialmente) -> Leen Asientos = 0 -> Reciben error "No quedan asientos".
    *   **Resultado:** 0 Overbookings.

### 2.2. Aceptación de Solicitudes (`accept_request`)
*   **Estado:** ⚠️ **UX Conflictiva (Modelo "Race-to-Pay")**.
*   **Funcionamiento:**
    1.  Conductor acepta solicitud de Usuario A. (No reserva asiento, solo habilita pago).
    2.  Conductor acepta solicitud de Usuario B. (Mismo asiento).
    3.  Usuario A y B reciben notificación "Solicitud Aceptada".
    4.  El primero que paga se queda el asiento.
*   **Riesgo:** Genera frustración en el usuario que llega segundo ("Me aceptaron pero no pude ir").
*   **Recomendación:** Cambiar a modelo de "Reserva Provisional" (bloquear asiento 10 min al aceptar) O dejar claro en la UI "Paga rápido para asegurar tu plaza".

## 3. Recomendaciones de Producto

### 3.1. Frontend de "Pedir Plaza"
*   **Observación:** Actualmente `RequestRideDialog.jsx` fuerza `seats=1` y `price=0`.
*   **Mejora:** Ahora que el backend es seguro (Patch V2), se pueden desbloquear estos campos en el UI para permitir:
    *   Viajes en grupo (2+ personas).
    *   Ofertas incentivadas (ofrecer pagar un poco más para atraer conductores).

### 3.2. Expiración de Solicitudes
*   **Observación:** Las solicitudes pendientes pueden quedarse "zombies" eternamente si nadie las acepta/rechaza.
*   **Acción:** Implementar un cronjob (pg_cron en Supabase) o Edge Function que marque como `expired` las solicitudes cuya `departure_time` ya pasó.

---
**Estado de la Auditoría:** Finalizada.
**Parches Aplicados:** `SECURITY_PATCH_V1.sql` y `SECURITY_PATCH_V2.sql` integrados en `rpc_functions.sql`.
