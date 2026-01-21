# 💰 AUDITORÍA FINANCIERA: Lógica de Pagos y Cobros

**Fecha:** 12 de Enero de 2026
**Alcance:** Flujo completo de fondos desde la reserva hasta la finalización del viaje.

---

## 🚨 RESUMEN DE RIESGOS DETECTADOS

| Riesgo | Severidad | Descripción |
| :--- | :---: | :--- |
| **Doble Gasto (Race Condition)** | 🔴 **CRÍTICA** | Es posible gastar el mismo saldo dos veces si se realizan reservas simultáneas en milisegundos. |
| **Falta de Idempotencia** | 🟠 **ALTA** | Si la función `complete_ride` se interrumpe o ejecuta dos veces, podría procesar pagos múltiples o dejar saldos inconsistentes. |
| **Redondeo** | 🟡 **MEDIA** | El cálculo de comisiones (15%) usa `ROUND(x, 2)`, lo que puede generar discrepancias de céntimos en volúmenes altos. |

---

## 🔍 ANÁLISIS DETALLADO

### 1. Bloqueo de Fondos (`confirm_trip_and_pay`)

*   **Estado Actual:**
    *   ✅ Bloquea la tabla `rides` (`FOR UPDATE`) para evitar overbooking de asientos.
    *   ❌ Lee el saldo del usuario (`SELECT balance FROM wallets`) **sin bloqueo**.
*   **Vulnerabilidad (Race Condition):**
    *   Escenario: Usuario con 20€ de saldo.
    *   Petición A (Viaje 1, 20€): Lee saldo (20€) -> OK -> Pausa milimétrica.
    *   Petición B (Viaje 2, 20€): Lee saldo (20€) -> OK (porque A aún no ha hecho UPDATE).
    *   Petición A: Resta 20€. Saldo real: 0€.
    *   Petición B: Resta 20€. Saldo real: -20€.
*   **Solución:** Añadir `FOR UPDATE` también a la lectura de la wallet.

### 2. Captura y Finalización (`complete_ride`)

*   **Estado Actual:**
    *   Itera sobre la lista de pasajeros y procesa pagos secuencialmente.
    *   Utiliza una única transacción de base de datos (Postgres es transaccional por defecto).
*   **Vulnerabilidad (Idempotencia):**
    *   Postgres garantiza atomicidad (todo o nada) en una sola ejecución. Sin embargo, si el cliente (Frontend) no recibe la confirmación por un error de red y reintenta la llamada:
    *   La función vuelve a ejecutarse. Si no verifica explícitamente que los pasajeros *ya fueron cobrados* (status = 'paid' o similar), volverá a descontar saldo.
*   **Solución:**
    *   Antes de cobrar, verificar si el pasajero ya tiene estado `completed` o `paid`.
    *   Al terminar el cobro de un pasajero, actualizar su estado dentro del JSON del viaje inmediatamente.

### 3. Reembolsos y Cancelaciones

*   **Estado Actual:**
    *   Lógica robusta de ventanas de tiempo ( >24h, >2h, etc).
    *   Correcta manipulación de `held_balance` vs `balance`.
*   **Observación:**
    *   La penalización del 50% se calcula sobre el precio congelado. Esto es correcto.

---

## 🛠️ PROPUESTA DE CORRECCIÓN (Script SQL)

Se recomienda aplicar un parche que:

1.  **Añada Locking a Wallets:** Modificar `confirm_trip_and_pay` para bloquear la fila del monedero durante la lectura.
2.  **Asegure Idempotencia:** Modificar `complete_ride` para ignorar pasajeros que no tengan estado estricto `confirmed` (evitando reprocesar los ya pagados si cambiamos su estado a `processed`).

### Ejemplo de Lógica Robusta para `complete_ride`:

```sql
FOR v_passenger IN SELECT * FROM jsonb_array_elements(v_passengers)
LOOP
    -- Solo procesar si está CONFIRMADO. Si ya está 'completed', saltar.
    IF v_passenger->>'status' = 'confirmed' THEN
        -- ... procesar pago ...
        
        -- MARCAR COMO PAGADO EN MEMORIA (para actualizar al final)
        -- Esto evita que una segunda ejecución los procese de nuevo
    END IF;
END LOOP;
```

¿Deseas que genere el script SQL para aplicar estas correcciones de seguridad financiera?
