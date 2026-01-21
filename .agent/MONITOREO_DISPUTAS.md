# 📊 CONFIGURACIÓN DE CRON JOB Y MONITOREO

## 🕒 CRON JOB: Levantamiento Automático de Suspensiones

### Opción A: Usando Supabase Cron (Recomendado)

1. **Accede a Supabase Dashboard**
2. **Ve a Database → Cron Jobs**
3. **Click en "Create a new cron job"**
4. **Configura:**

```
Name: lift-expired-suspensions
Schedule: 0 * * * *
Command: SELECT public.lift_suspension_if_expired();
```

5. **Click en "Create"**

### Opción B: SQL Manual

Si no tienes acceso a la UI de Cron Jobs, ejecuta esto en SQL Editor:

```sql
-- Requiere la extensión pg_cron
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Crear el cron job
SELECT cron.schedule(
    'lift-expired-suspensions',
    '0 * * * *',  -- Cada hora en punto
    $$ SELECT public.lift_suspension_if_expired(); $$
);

-- Verificar que se creó
SELECT * FROM cron.job WHERE jobname = 'lift-expired-suspensions';
```

---

## 📈 QUERIES DE MONITOREO

### 1. Dashboard de Disputas

```sql
-- Vista general de disputas
SELECT 
    status,
    COUNT(*) as total,
    ROUND(AVG(refund_amount), 2) as avg_refund,
    ROUND(SUM(refund_amount), 2) as total_refund
FROM public.cancellation_disputes
GROUP BY status
ORDER BY total DESC;
```

**Resultado esperado:**
```
status    | total | avg_refund | total_refund
----------|-------|------------|-------------
pending   |   5   |    8.50    |    42.50
approved  |   3   |   10.00    |    30.00
rejected  |   2   |    7.00    |    14.00
```

---

### 2. Usuarios con Más Cancelaciones

```sql
-- Top 10 usuarios con más cancelaciones
SELECT 
    p.id,
    p.display_name,
    p.email,
    p.cancellation_count_30d,
    p.is_suspended,
    p.suspension_until,
    p.rating
FROM public.profiles p
WHERE p.cancellation_count_30d > 0
ORDER BY p.cancellation_count_30d DESC
LIMIT 10;
```

---

### 3. Disputas Pendientes de Revisión

```sql
-- Disputas que requieren atención inmediata
SELECT 
    cd.id,
    cd.created_at,
    cd.user_type,
    cd.refund_amount,
    cd.reason,
    p.display_name as user_name,
    p.email as user_email,
    r.origin->>'name' as origin,
    r.destination->>'name' as destination
FROM public.cancellation_disputes cd
JOIN public.profiles p ON cd.user_id = p.id
JOIN public.rides r ON cd.ride_id = r.id
WHERE cd.status = 'pending'
ORDER BY cd.created_at ASC;
```

---

### 4. Métricas de Tiempo de Resolución

```sql
-- Tiempo promedio de resolución de disputas
SELECT 
    ROUND(AVG(EXTRACT(EPOCH FROM (resolved_at - created_at)) / 3600), 2) as avg_hours,
    MIN(resolved_at - created_at) as fastest_resolution,
    MAX(resolved_at - created_at) as slowest_resolution
FROM public.cancellation_disputes
WHERE status IN ('approved', 'rejected')
AND resolved_at IS NOT NULL;
```

---

### 5. Tasa de Aprobación

```sql
-- Tasa de aprobación de disputas
SELECT 
    COUNT(*) FILTER (WHERE status = 'approved') as approved,
    COUNT(*) FILTER (WHERE status = 'rejected') as rejected,
    COUNT(*) FILTER (WHERE status = 'pending') as pending,
    ROUND(
        COUNT(*) FILTER (WHERE status = 'approved')::DECIMAL / 
        NULLIF(COUNT(*) FILTER (WHERE status IN ('approved', 'rejected')), 0) * 100,
        2
    ) as approval_rate_percent
FROM public.cancellation_disputes;
```

---

### 6. Usuarios Actualmente Suspendidos

```sql
-- Lista de usuarios suspendidos
SELECT 
    id,
    display_name,
    email,
    suspension_until,
    cancellation_count_30d,
    EXTRACT(DAYS FROM (suspension_until - NOW())) as days_remaining
FROM public.profiles
WHERE is_suspended = true
AND suspension_until > NOW()
ORDER BY suspension_until ASC;
```

---

### 7. Historial de Penalizaciones

```sql
-- Usuarios que han sido penalizados
SELECT 
    p.display_name,
    p.email,
    p.rating,
    p.cancellation_count_30d,
    CASE 
        WHEN p.cancellation_count_30d >= 5 THEN 'Suspendido'
        WHEN p.cancellation_count_30d >= 3 THEN 'Penalizado'
        ELSE 'Normal'
    END as status
FROM public.profiles p
WHERE p.cancellation_count_30d >= 3
ORDER BY p.cancellation_count_30d DESC;
```

---

## 🔔 ALERTAS RECOMENDADAS

### Alerta 1: Muchas Disputas Pendientes

```sql
-- Ejecutar cada hora
SELECT COUNT(*) as pending_disputes
FROM public.cancellation_disputes
WHERE status = 'pending'
AND created_at < NOW() - INTERVAL '24 hours';

-- Si el resultado es > 5, enviar alerta a admins
```

### Alerta 2: Pico de Cancelaciones

```sql
-- Ejecutar diariamente
SELECT COUNT(*) as cancellations_today
FROM public.rides
WHERE status = 'cancelled'
AND cancelled_at > NOW() - INTERVAL '24 hours';

-- Si el resultado es > 20, investigar
```

### Alerta 3: Usuario con Patrón Sospechoso

```sql
-- Ejecutar diariamente
SELECT 
    p.id,
    p.display_name,
    p.email,
    p.cancellation_count_30d
FROM public.profiles p
WHERE p.cancellation_count_30d >= 4
AND NOT p.is_suspended;

-- Notificar a admins para revisión manual
```

---

## 📊 DASHBOARD RECOMENDADO

### KPIs Principales

1. **Disputas Activas:** Número de disputas pendientes
2. **Tiempo Promedio de Resolución:** < 24 horas (objetivo)
3. **Tasa de Aprobación:** 20-30% (esperado)
4. **Usuarios Suspendidos:** < 1% de usuarios activos
5. **Cancelaciones Diarias:** Tendencia y picos

### Gráficos Sugeridos

1. **Línea de Tiempo:** Disputas creadas vs resueltas por día
2. **Pie Chart:** Distribución de estados (pending/approved/rejected)
3. **Bar Chart:** Top 10 razones de disputa
4. **Heatmap:** Cancelaciones por día de la semana y hora

---

## 🔧 MANTENIMIENTO

### Limpieza de Datos Antiguos (Ejecutar mensualmente)

```sql
-- Archivar disputas resueltas de hace más de 6 meses
-- (Opcional: mover a tabla de archivo antes de eliminar)
DELETE FROM public.cancellation_disputes
WHERE status IN ('approved', 'rejected')
AND resolved_at < NOW() - INTERVAL '6 months';
```

### Reseteo de Contadores (Automático)

El sistema ya resetea automáticamente los contadores de cancelación cada 30 días mediante la función `check_cancellation_abuse`.

---

## ✅ CHECKLIST DE CONFIGURACIÓN

- [ ] Cron job de suspensiones configurado
- [ ] Queries de monitoreo guardadas
- [ ] Dashboard de métricas creado (opcional)
- [ ] Alertas configuradas (opcional)
- [ ] Proceso de limpieza programado (opcional)

---

## 📞 SOPORTE

Si necesitas ayuda con la configuración:
1. Verifica los logs de Supabase: **Logs → Postgres Logs**
2. Revisa el estado del cron job: `SELECT * FROM cron.job;`
3. Ejecuta los tests: `TEST_DISPUTES_SYSTEM.sql`
