# 🧪 SMOKE TEST MANUAL - GUÍA PASO A PASO

**Objetivo**: Validar que el flujo completo de carpooling funciona end-to-end en producción.

**Duración estimada**: 15 minutos

---

## 📋 PREPARACIÓN

### Necesitarás:
- ✅ 2 cuentas de usuario diferentes (Conductor y Pasajero)
- ✅ Ambas con saldo en wallet (mínimo 50€ para el pasajero)
- ✅ Acceso a la aplicación web/móvil

### Cuentas de Test Sugeridas:
```
Conductor: driver.elite@shareway.test / ShareWayTest2026!
Pasajero:  passenger.1@shareway.test / ShareWayTest2026!
```

---

## 🚗 FASE 1: CREAR VIAJE (Como Conductor)

### Paso 1.1: Login como Conductor
1. Abre la aplicación
2. Login con `driver.elite@shareway.test`
3. Verifica que estás en el dashboard

### Paso 1.2: Publicar Viaje
1. Click en "Publicar Viaje" / "Offer Ride"
2. Completa los datos:
   ```
   Origen: Madrid (Puerta del Sol)
   Destino: Barcelona (Plaza Catalunya)
   Fecha: Mañana a las 10:00
   Asientos: 3
   Precio: 25€ por asiento
   Detalles: "Viaje de prueba - Smoke Test"
   ```
3. Click en "Publicar"

### ✅ Verificación 1.2:
- [ ] El viaje se crea sin errores
- [ ] Aparece en "Mis Viajes" como conductor
- [ ] Estado: "Programado" / "Scheduled"

### 🔍 Query de Verificación Backend:
```sql
-- Ejecutar en Supabase SQL Editor
SELECT 
    id, 
    driver_display_name, 
    status, 
    seats_available,
    price,
    departure_time
FROM public.rides 
WHERE driver_id = (SELECT id FROM auth.users WHERE email = 'driver.elite@shareway.test')
ORDER BY created_at DESC 
LIMIT 1;
```

**Resultado esperado**: 1 fila con status='scheduled', seats_available=3, price=25

---

## 👤 FASE 2: RESERVAR VIAJE (Como Pasajero)

### Paso 2.1: Login como Pasajero
1. Abre una ventana de incógnito / navegador diferente
2. Login con `passenger.1@shareway.test`
3. Verifica que estás en el dashboard

### Paso 2.2: Buscar Viaje
1. Click en "Buscar Viaje" / "Search Ride"
2. Busca:
   ```
   Origen: Madrid
   Destino: Barcelona
   Fecha: Mañana
   ```
3. Deberías ver el viaje que acabas de crear

### Paso 2.3: Reservar
1. Click en el viaje
2. Click en "Reservar" / "Book"
3. Confirma el pago (25€)

### ✅ Verificación 2.3:
- [ ] La reserva se procesa sin errores
- [ ] Ves un PIN de 4 dígitos
- [ ] El viaje aparece en "Mis Viajes" como pasajero
- [ ] Tu saldo disminuyó 25€

### 🔍 Query de Verificación Backend:
```sql
-- Verificar que el dinero se retuvo correctamente
SELECT 
    user_id,
    balance,
    held_balance,
    balance + held_balance as total
FROM public.wallets 
WHERE user_id = (SELECT id FROM auth.users WHERE email = 'passenger.1@shareway.test');

-- Verificar que el pasajero está en el viaje
SELECT 
    id,
    seats_available,
    jsonb_array_length(passengers) as passenger_count,
    passengers
FROM public.rides 
WHERE driver_id = (SELECT id FROM auth.users WHERE email = 'driver.elite@shareway.test')
ORDER BY created_at DESC 
LIMIT 1;
```

**Resultado esperado**: 
- `held_balance` = 25
- `seats_available` = 2 (era 3, ahora 2)
- `passenger_count` = 1
- `passengers` contiene el objeto del pasajero con status='confirmed' y un PIN

---

## 🚀 FASE 3: INICIAR VIAJE (Como Conductor)

### Paso 3.1: Volver a la sesión del Conductor
1. En la ventana del conductor
2. Ve a "Mis Viajes"
3. Click en el viaje que creaste

### Paso 3.2: Iniciar Viaje
1. Click en "Iniciar Viaje" / "Start Ride"
2. Confirma

### ✅ Verificación 3.2:
- [ ] El viaje cambia a estado "En curso" / "Active"
- [ ] Puedes ver la lista de pasajeros
- [ ] Ves el PIN del pasajero

### 🔍 Query de Verificación Backend:
```sql
SELECT 
    id,
    status,
    started_at
FROM public.rides 
WHERE driver_id = (SELECT id FROM auth.users WHERE email = 'driver.elite@shareway.test')
ORDER BY created_at DESC 
LIMIT 1;
```

**Resultado esperado**: status='active', started_at tiene una fecha

---

## ✅ FASE 4: VERIFICAR PASAJERO (Como Conductor)

### Paso 4.1: Obtener PIN del Pasajero
1. En la vista del viaje activo
2. Deberías ver el pasajero con su PIN (ej: "1234")

### Paso 4.2: Verificar PIN
1. Click en "Verificar Pasajero" / "Verify Passenger"
2. Introduce el PIN que ves
3. Confirma

### ✅ Verificación 4.2:
- [ ] El pasajero cambia a estado "Verificado" / "Verified"
- [ ] Aparece un check verde o similar

### 🔍 Query de Verificación Backend:
```sql
SELECT 
    passengers
FROM public.rides 
WHERE driver_id = (SELECT id FROM auth.users WHERE email = 'driver.elite@shareway.test')
ORDER BY created_at DESC 
LIMIT 1;
```

**Resultado esperado**: El objeto del pasajero tiene status='verified'

---

## 🏁 FASE 5: COMPLETAR VIAJE (Como Conductor)

### Paso 5.1: Completar Viaje
1. Click en "Completar Viaje" / "Complete Ride"
2. Confirma

### ✅ Verificación 5.1:
- [ ] El viaje cambia a "Completado" / "Completed"
- [ ] Tu saldo aumentó ~22.50€ (90% de 25€)
- [ ] El pasajero ya no tiene dinero retenido

### 🔍 Query de Verificación Backend:
```sql
-- Verificar estado del viaje
SELECT 
    id,
    status,
    completed_at
FROM public.rides 
WHERE driver_id = (SELECT id FROM auth.users WHERE email = 'driver.elite@shareway.test')
ORDER BY created_at DESC 
LIMIT 1;

-- Verificar pago al conductor
SELECT 
    balance,
    held_balance
FROM public.wallets 
WHERE user_id = (SELECT id FROM auth.users WHERE email = 'driver.elite@shareway.test');

-- Verificar liberación de fondos del pasajero
SELECT 
    balance,
    held_balance
FROM public.wallets 
WHERE user_id = (SELECT id FROM auth.users WHERE email = 'passenger.1@shareway.test');

-- Verificar transacciones
SELECT 
    type,
    amount,
    description,
    created_at
FROM public.transactions 
WHERE related_ride_id = (
    SELECT id FROM public.rides 
    WHERE driver_id = (SELECT id FROM auth.users WHERE email = 'driver.elite@shareway.test')
    ORDER BY created_at DESC 
    LIMIT 1
)
ORDER BY created_at;
```

**Resultado esperado**:
- Viaje: status='completed', completed_at tiene fecha
- Conductor: balance aumentó ~22.50€
- Pasajero: held_balance = 0
- Transacciones: Deberías ver 2 transacciones (hold + payout)

---

## 🎯 CHECKLIST FINAL

Si completaste todo sin errores:

- [ ] ✅ Viaje creado correctamente
- [ ] ✅ Búsqueda funcionando
- [ ] ✅ Reserva con escrow exitosa
- [ ] ✅ PIN generado y visible
- [ ] ✅ Viaje iniciado correctamente
- [ ] ✅ Verificación de PIN funcionando
- [ ] ✅ Viaje completado
- [ ] ✅ Pago al conductor (90%)
- [ ] ✅ Liberación de fondos del pasajero
- [ ] ✅ Transacciones registradas

---

## 🚨 SI ALGO FALLA

### Error en Creación de Viaje
```sql
-- Ver últimos errores
SELECT * FROM public.rpc_error_logs 
WHERE function_name = 'create_ride'
ORDER BY created_at DESC LIMIT 5;
```

### Error en Reserva
```sql
-- Ver últimos errores
SELECT * FROM public.rpc_error_logs 
WHERE function_name = 'confirm_trip_and_pay'
ORDER BY created_at DESC LIMIT 5;
```

### Error en Completar Viaje
```sql
-- Ver últimos errores
SELECT * FROM public.rpc_error_logs 
WHERE function_name = 'complete_ride'
ORDER BY created_at DESC LIMIT 5;
```

### Dinero Desaparecido
```sql
-- Verificar integridad total
SELECT 
    SUM(balance + held_balance) as total_money
FROM public.wallets;
```

---

## ✅ RESULTADO ESPERADO

Si todo funciona correctamente:
- **Tiempo total**: ~10-15 minutos
- **Errores**: 0
- **Transacciones**: 2 (hold + payout)
- **Integridad financiera**: Conservada (dinero no desaparece)

---

## 🎉 PRÓXIMO PASO

Una vez completado el smoke test exitosamente:
1. ✅ Marca como completado en `PRODUCTION_CERTIFICATION.md`
2. ✅ Configura backups automáticos en Supabase
3. ✅ Prepara el lanzamiento a usuarios beta (10-20 personas)
4. ✅ Configura monitoreo de errores

**¡Estás listo para producción!** 🚀
