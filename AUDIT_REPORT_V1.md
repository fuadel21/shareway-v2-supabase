# Auditoría Técnica: Sharway Ride & Booking System
**Fecha:** 2026-01-13
**Auditor:** Senior Product Engineer & QA Lead
**Alcance:** Flujos "Ofrecer Plaza" (CreateRide), "Pedir Plaza" (RequestRide) y Lógica de Reservas (Booking/Payment).

---

## 1. Resumen Ejecutivo
La arquitectura actual basada en Supabase RPC proporciona una base sólida para la integridad transaccional, especialmente con el uso de `FOR UPDATE` para prevenir condiciones de carrera en las reservas (overbooking). Sin embargo, existen vulnerabilidades críticas en la validación de datos de entrada (precios) y ausencia de límites de tasa (rate limiting) que exponen a la plataforma a riesgos de abuso y fraude.

## 2. Vulnerabilidades Críticas (Prioridad Alta)

### 2.1. Ausencia de Validación de Precio en Backend (Riesgo de Fraude)
*   **Ubicación:** `create_ride` (RPC)
*   **Hallazgo:** Aunque el frontend valida un "Precio Justo" (0.50€/km), la función RPC `create_ride` solo verifica que el precio no sea negativo (`p_price < 0`).
*   **Riesgo:** Un usuario malintencionado podría llamar directamente a la API RPC y crear viajes con precios abusivos (ej. 1000€) o precios infinitesimales para manipular el sistema.
*   **Recomendación:** Implementar un límite máximo por km en la función SQL (ej. 0.50€ * distancia_km).

### 2.2. Falta de Rate Limiting (Riesgo de Spam/DoS)
*   **Ubicación:** `create_ride`, `create_ride_request`
*   **Hallazgo:** No existe limitación en el número de viajes o solicitudes que un usuario puede crear por minuto/hora.
*   **Riesgo:** Un atacante podría inundar la base de datos con miles de viajes "basura", degradando el rendimiento de las búsquedas y afectando la experiencia de usuario.
*   **Recomendación:** Implementar un control de frecuencia (ej. máx 5 viajes activos por conductor, o máx 1 creación cada 5 minutos).

## 3. Brechas Lógicas y de Flujo (Prioridad Media)

### 3.1. Superposición de Viajes (Driver Overlap)
*   **Ubicación:** `create_ride`
*   **Hallazgo:** El sistema permite que un conductor publique múltiples viajes que se solapan en el tiempo (ej. Viaje A a las 10:00 y Viaje B a las 10:15 el mismo día).
*   **Impacto:** Imposibilidad física de cumplir ambos compromisos, llevando a cancelaciones y mala experiencia.
*   **Recomendación:** Verificar en `create_ride` que el conductor no tenga otro viaje `active` o `scheduled` en un intervalo de +/- X horas del nuevo viaje.

### 3.2. Dependencia de "Magic Strings" en Estados
*   **Ubicación:** Múltiples funciones (`status = 'verified'`, `status = 'scheduled'`)
*   **Hallazgo:** El uso de cadenas de texto literales es propenso a errores humanos (typos) en futuras actualizaciones.
*   **Recomendación:** (Refactorización a largo plazo) Usar ENUMs de PostgreSQL para estados críticos.

## 4. Análisis de UX y Producto

### 4.1. Política de Reembolso "Paranoic"
*   **Observación:** La lógica de reembolso está "hardcoded" en `cancel_booking_and_refund`.
    *   *Regla:* < 2h para salida = 0% reembolso.
*   **Mejora:** Esta lógica es correcta según especificación, pero su rigidez en SQL dificulta cambios rápidos de estrategia comercial (ej. campañas de "cancelación gratuita en verano").
*   **Propuesta:** Mover los parámetros de configuración (ventanas de tiempo, porcentajes) a una tabla de configuración (`app_config`) para permitir ajustes dinámicos sin despliegues de código.

## 5. Plan de Acción y Correcciones Propuestas

He preparado un script de remediación (`SECURITY_PATCH_V1.sql`) que aborda los puntos 2.1 y 3.1 inmediatamente.

### Correcciones a aplicar:
1.  **Validación de Precio Máximo:** Añadir chequeo en `create_ride` basado en la distancia (si está disponible).
2.  **Prevención de Solapamiento:** Añadir chequeo de conflictos de horario en `create_ride`.
3.  **Límite de Viajes Activos:** Restringir a un máximo razonable de viajes futuros por conductor.

---
**Estado de la Auditoría:** Completada.
**Siguiente Paso:** Aplicar parches de seguridad.
