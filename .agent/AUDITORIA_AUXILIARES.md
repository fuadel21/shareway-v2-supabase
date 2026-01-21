# 🔎 AUDITORÍA DE MÓDULOS AUXILIARES: Reseñas y Notificaciones

**Fecha:** 12 de Enero de 2026
**Alcance:** Sistemas de reputación y comunicación asíncrona.

---

## 1. SISTEMA DE RESEÑAS (Reviews)

### 🚨 Hallazgos Críticos
*   **Falsificación de Reseñas:** La función `submit_reviews` no valida que exista una relación real entre el autor y el reseñado en el contexto del viaje.
    *   *Riesgo:* Un usuario malintencionado podría enviar reseñas negativas masivas a cualquier usuario de la plataforma simplemente conociendo su ID y un Ride ID cualquiera.
*   **Estado del Viaje:** Se pueden enviar reseñas antes de que el viaje termine.

### ✅ Solución Propuesta (Corrección)
Endurecer la función `submit_reviews` para verificar estrictamente:
1.  `v_author_id` era participante del viaje.
2.  `target_id` era participante del viaje.
3.  El viaje tiene estado `completed`.

---

## 2. SISTEMA DE NOTIFICACIONES

### ⚠️ Hallazgos de Mantenimiento
*   **Acumulación de Basura:** No existe un mecanismo de limpieza (`TTL`) para las notificaciones.
*   **Impacto a Largo Plazo:** La tabla crecerá indefinidamente, degradando el rendimiento de las consultas "Mis notificaciones" en el dashboard.

### ✅ Solución Propuesta (Optimización)
1.  Crear una función `cleanup_notifications()` que borre notificaciones antiguas (ej: > 30 días) y leídas.
2.  Invocar esta limpieza periódicamente (pg_cron) o como parte de tareas de mantenimiento ligeras.

---

## 🛠️ ACTUACIÓN
Procederé a crear un script SQL que:
1.  Reemplace `submit_reviews` con la versión segura.
2.  Cree la función de mantenimiento de notificaciones.
