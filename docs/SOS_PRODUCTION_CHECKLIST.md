# ShareWay — Checklist de producción del flujo SOS

Este documento sirve para probar el flujo SOS completo antes de dejarlo como estable en producción.

## Estado esperado del sistema

El flujo SOS completo debe hacer esto:

1. El usuario entra en un viaje activo.
2. El botón/panel SOS aparece solo a conductor o pasajero del viaje.
3. El usuario confirma la activación.
4. Se crea una fila en `public.emergency_alerts`.
5. Se crea o reutiliza un chat de tipo `emergency`.
6. Se crea un mensaje inicial en `public.messages`.
7. Se crea una notificación crítica para admins.
8. El usuario entra en `/emergency/:rideId`.
9. El admin ve la alerta en `/admin/sos`.
10. El viaje muestra historial/auditoría en `/ride/:id`.

---

## 1. Checklist de despliegue

Antes de probar:

- [ ] PR #28 ejecutado en Supabase: tabla `emergency_alerts` y RPC `trigger_emergency_alert_v2`.
- [ ] PR #29 desplegado: panel admin `/admin/sos`.
- [ ] PR #30 ejecutado en Supabase: trigger de notificaciones admin.
- [ ] PR #31 desplegado: botón/panel SOS rápido.
- [ ] PR #32 desplegado: canal SOS estable.
- [ ] PR #33 desplegado: historial/auditoría del viaje.
- [ ] Vercel muestra deploy `Ready`.
- [ ] El usuario admin existe en `profiles` con `role = 'admin'`, `role = 'super_admin'` o `is_admin = true`.

---

## 2. Comprobaciones SQL iniciales

### 2.1 Tabla de alertas

```sql
select column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'emergency_alerts'
order by ordinal_position;
```

Debe existir como mínimo:

- `id`
- `ride_id`
- `user_id`
- `chat_id`
- `status`
- `severity`
- `current_location`
- `metadata`
- `created_at`
- `updated_at`

### 2.2 RPC activa

```sql
select proname, proargtypes::regtype[]
from pg_proc
where proname = 'trigger_emergency_alert_v2';
```

Resultado esperado:

```text
trigger_emergency_alert_v2 | {uuid,jsonb,jsonb}
```

Si aparece también `{uuid,jsonb}`, eliminar la versión antigua:

```sql
drop function if exists public.trigger_emergency_alert_v2(uuid, jsonb);
```

### 2.3 Trigger de notificaciones admin

```sql
select 
  trigger_name,
  event_manipulation,
  event_object_table
from information_schema.triggers
where event_object_schema = 'public'
  and event_object_table = 'emergency_alerts'
  and trigger_name = 'trg_notify_admins_on_emergency_alert';
```

Debe salir:

```text
trg_notify_admins_on_emergency_alert | INSERT | emergency_alerts
```

### 2.4 Usuarios admin detectables

```sql
select id, email, display_name, role, is_admin
from public.profiles
where coalesce(role, '') in ('admin', 'super_admin')
   or coalesce(is_admin, false) = true;
```

Debe salir al menos una cuenta admin.

---

## 3. Prueba como conductor

1. Entrar con una cuenta conductora.
2. Crear o abrir un viaje.
3. Poner el viaje en estado `active` o `in_progress`.
4. Abrir `/ride/:id`.
5. Confirmar que aparece el panel rojo `SOS rápido`.
6. Pulsar `Activar SOS`.
7. Confirmar en el diálogo.
8. Debe abrir `/emergency/:rideId`.
9. Enviar un mensaje de prueba.
10. Confirmar que el mensaje aparece sin recargar.

Validar en SQL:

```sql
select 
  id,
  ride_id,
  user_id,
  chat_id,
  status,
  severity,
  current_location,
  metadata,
  created_at
from public.emergency_alerts
order by created_at desc
limit 10;
```

---

## 4. Prueba como pasajero

1. Entrar con una cuenta pasajera confirmada en el viaje.
2. Abrir `/ride/:id`.
3. Confirmar que aparece el panel `SOS rápido` si el viaje está activo.
4. Activar SOS y confirmar.
5. Debe abrir `/emergency/:rideId`.
6. Enviar mensaje.
7. Confirmar que el conductor o usuario relacionado puede ver el canal según permisos.

---

## 5. Prueba como admin

1. Entrar con cuenta admin.
2. Abrir `/admin/sos`.
3. Confirmar que aparece la alerta.
4. Revisar:
   - usuario;
   - viaje;
   - estado;
   - severidad;
   - ubicación GPS si existe;
   - chat asociado.
5. Pulsar `Reconocer`.
6. Confirmar que pasa a `acknowledged`.
7. Pulsar `Resolver`.
8. Confirmar que pasa a `resolved`.

Validar en SQL:

```sql
select 
  id,
  status,
  acknowledged_by,
  acknowledged_at,
  resolved_by,
  resolved_at,
  updated_at
from public.emergency_alerts
order by created_at desc
limit 10;
```

---

## 6. Prueba de notificación admin

Después de activar SOS:

```sql
select 
  id,
  user_id,
  title,
  priority,
  is_pinned,
  action_url,
  entity_type,
  entity_id,
  metadata,
  created_at
from public.notifications
where entity_type = 'emergency_alert'
order by created_at desc
limit 20;
```

Resultado esperado:

- `priority = critical`
- `is_pinned = true`
- `action_url = /admin/sos`
- `entity_type = emergency_alert`
- `entity_id = id de la alerta`

---

## 7. Prueba de historial en el viaje

1. Abrir `/ride/:id` como usuario relacionado.
2. Si hay alertas visibles, debe aparecer el panel `Auditoría del viaje`.
3. Abrir el panel.
4. Confirmar que muestra:
   - número de alertas;
   - estado;
   - severidad;
   - fecha;
   - GPS si existe;
   - botón de canal;
   - ID de alerta.
5. Cambiar el estado desde `/admin/sos`.
6. Confirmar que el panel se actualiza por realtime o con refresco manual.

---

## 8. Prueba de RLS básica

### Usuario relacionado

Debe poder ver alertas de su viaje.

### Usuario no relacionado

No debe poder ver alertas de otros viajes.

### Admin

Debe poder ver y actualizar alertas.

### Cliente normal

No debe poder borrar alertas.

Comprobación de políticas:

```sql
select policyname, cmd
from pg_policies
where schemaname = 'public'
  and tablename = 'emergency_alerts'
order by policyname;
```

Políticas esperadas:

- `emergency_alerts_insert_own_related`
- `emergency_alerts_no_client_delete`
- `emergency_alerts_select_related_or_admin`
- `emergency_alerts_update_admin_only`

---

## 9. Casos de error que deben comportarse bien

- [ ] Sin GPS: debe crear alerta igualmente con `current_location = null`.
- [ ] Chat tarda en crearse: `/emergency/:rideId` debe mostrar espera y reintentar.
- [ ] Usuario no relacionado abre `/emergency/:rideId`: debe fallar sin mostrar datos sensibles.
- [ ] Admin resuelve alerta: el usuario relacionado debe ver estado actualizado en historial.
- [ ] Reabrir canal varias veces: no debe duplicar mensajes por listeners colgados.
- [ ] Pulsación accidental: siempre debe pedir confirmación antes de activar.

---

## 10. Checklist final antes de producción estable

- [ ] Deploy frontend en Vercel `Ready`.
- [ ] SQL de alertas ejecutado sin errores.
- [ ] RPC única `trigger_emergency_alert_v2(uuid,jsonb,jsonb)`.
- [ ] Trigger `trg_notify_admins_on_emergency_alert` instalado.
- [ ] Existe al menos un admin detectable por trigger.
- [ ] Botón SOS aparece solo en viaje activo.
- [ ] Canal `/emergency/:rideId` carga y permite enviar mensaje.
- [ ] Admin ve la alerta en `/admin/sos`.
- [ ] Admin puede reconocer/resolver.
- [ ] Notificación admin creada.
- [ ] Historial aparece en `/ride/:id`.
- [ ] Usuario no relacionado no ve datos.
- [ ] No hay errores en consola críticos.

---

## 11. SQL rápido de revisión completa

```sql
select 'emergency_alerts' as check_name, count(*) as total
from public.emergency_alerts
union all
select 'admin_notifications' as check_name, count(*) as total
from public.notifications
where entity_type = 'emergency_alert';
```

Últimas alertas:

```sql
select 
  ea.id,
  ea.ride_id,
  ea.user_id,
  ea.chat_id,
  ea.status,
  ea.severity,
  ea.created_at,
  ea.updated_at
from public.emergency_alerts ea
order by ea.created_at desc
limit 20;
```

Últimas notificaciones admin:

```sql
select 
  id,
  user_id,
  title,
  priority,
  is_pinned,
  action_url,
  entity_id,
  created_at
from public.notifications
where entity_type = 'emergency_alert'
order by created_at desc
limit 20;
```
