# 🚀 GUÍA DE DESPLIEGUE: SISTEMA FINANCIERO UNIFICADO SHAREWAY V2

## 📋 RESUMEN EJECUTIVO

Este documento describe el orden de ejecución de los scripts SQL para implementar el sistema financiero completo de ShareWay v2, que incluye:

- ✅ Motor de pagos unificado (Wallet + Stripe)
- ✅ Sistema de escrow (held_balance)
- ✅ Cancelaciones con penalizaciones dinámicas
- ✅ Reembolsos automáticos y manuales
- ✅ Disputas y resolución administrativa
- ✅ Retiros a banco (Payouts)
- ✅ Auditoría financiera completa

---

## 🎯 ORDEN DE EJECUCIÓN (CRÍTICO)

Ejecuta estos archivos **EN ESTE ORDEN EXACTO** en el SQL Editor de Supabase:

### FASE 1: Fundamentos (Tablas y Estructura)
```sql
-- 1. Asegurar estructura de wallets y transacciones
\i supabase/wallet_fix_final.sql
```

### FASE 2: Motor Financiero Core
```sql
-- 2. Sistema unificado de pagos y comisiones
\i supabase/FINAL_UNIFIED_FINANCIAL_ENGINE.sql

-- 3. Handlers para pagos externos (Stripe)
\i supabase/MASTER_FINANCIAL_HANDLERS.sql

-- 4. Consolidación de pagos Stripe en viajes
\i supabase/STRIPE_CONSOLIDATION_ENGINE.sql
```

### FASE 3: Cancelaciones y Penalizaciones
```sql
-- 5. Motor de cancelaciones con penalizaciones
\i supabase/FINAL_CANCELLATION_ENGINE.sql
```

### FASE 4: Reembolsos y Disputas
```sql
-- 6. Sistema de reembolsos manuales y administrativos
\i supabase/FINAL_REFUND_ENGINE.sql

-- 7. Sistema unificado de reembolsos con logs
\i supabase/MASTER_REFUND_SYSTEM.sql

-- 8. Sistema de disputas (ya existente, verificar)
\i supabase/dispute_system.sql
```

### FASE 5: Retiros (Payouts)
```sql
-- 9. Motor de retiros a banco
\i supabase/MASTER_PAYOUT_ENGINE.sql
```

---

## 🔍 VERIFICACIÓN POST-DESPLIEGUE

Ejecuta estas consultas para verificar que todo está correcto:

### 1. Verificar Funciones Críticas
```sql
SELECT routine_name, routine_type 
FROM information_schema.routines 
WHERE routine_schema = 'public' 
AND routine_name IN (
    'confirm_trip_and_pay',
    'complete_ride',
    'cancel_ride',
    'cancel_booking_and_refund',
    'confirm_stripe_booking',
    'fulfill_booking_after_payment',
    'credit_wallet_on_success',
    'admin_force_refund',
    'request_payout',
    'cancel_payout'
)
ORDER BY routine_name;
```

### 2. Verificar Tablas
```sql
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN (
    'wallets',
    'wallet_transactions',
    'transactions',
    'refund_logs',
    'payout_requests',
    'cancellation_disputes'
)
ORDER BY table_name;
```

### 3. Verificar Cuenta de Tesorería
```sql
-- Debe existir una wallet para la plataforma
SELECT * FROM public.wallets 
WHERE user_id = '00000000-0000-0000-0000-000000000000';

-- Si no existe, créala:
INSERT INTO public.wallets (user_id, balance, held_balance)
VALUES ('00000000-0000-0000-0000-000000000000', 0, 0)
ON CONFLICT (user_id) DO NOTHING;
```

---

## 💰 FLUJOS FINANCIEROS IMPLEMENTADOS

### A. PAGO CON SALDO (Wallet)
1. Usuario llama a `confirm_trip_and_pay(ride_id, pickup_location, pickup_address)`
2. Se verifica saldo disponible
3. Se mueve dinero de `balance` → `held_balance` (escrow)
4. Se registra transacción tipo `hold`
5. Se añade pasajero al viaje con status `confirmed`

### B. PAGO CON TARJETA (Stripe)
1. Frontend llama a Edge Function `create-booking-payment-intent`
2. Se crea Payment Intent en Stripe
3. Se registra intención en `ride_requests` con `payment_intent_id`
4. Usuario completa pago en Stripe
5. Webhook recibe `payment_intent.succeeded`
6. Se llama a `fulfill_booking_after_payment` que:
   - Mueve dinero a `held_balance` (escrow interno)
   - Añade pasajero al viaje
   - Marca request como `fulfilled`

### C. COMPLETAR VIAJE
1. Conductor llama a `complete_ride(ride_id)`
2. Para cada pasajero confirmado:
   - Se resta de `held_balance`
   - Se calcula comisión (15%)
   - Conductor recibe 85% en `balance`
   - Plataforma recibe 15% en su wallet
3. Se registran transacciones tipo `trip_payment` y `trip_earning`
4. Se calcula CO2 ahorrado

### D. CANCELACIÓN POR CONDUCTOR
1. Conductor llama a `cancel_ride(ride_id)`
2. Se calcula penalización según urgencia:
   - < 2h: 5.00€
   - < 24h: 2.00€
   - > 24h: 0€
3. Penalización se reparte:
   - 50% a pasajeros (compensación)
   - 50% a plataforma
4. Pasajeros reciben 100% reembolso + compensación

### E. CANCELACIÓN POR PASAJERO
1. Pasajero llama a `cancel_booking_and_refund(ride_id)`
2. Se calcula reembolso según tiempo:
   - > 24h o < 15min desde reserva: 100%
   - 2-24h: 50%
   - < 2h: 0%
3. Penalización se reparte:
   - 80% conductor
   - 20% plataforma

### F. REEMBOLSO EXTRAORDINARIO (Admin)
1. Admin llama a `admin_force_refund(ride_id, passenger_id, reason)`
2. Se devuelve 100% desde escrow o tesorería
3. Se registra en `refund_logs` para auditoría

### G. RETIRO A BANCO
1. Usuario llama a `request_payout(amount, type)`
2. Se resta de `balance` inmediatamente
3. Se crea registro en `payout_requests` con status `pending`
4. Admin procesa manualmente en Stripe
5. Admin marca como `completed` o usuario puede cancelar si aún está `pending`

---

## 🛡️ GARANTÍAS DE INTEGRIDAD

### 1. Bloqueos Pesimistas (FOR UPDATE)
- Todas las operaciones financieras usan `FOR UPDATE` en wallets y rides
- Previene race conditions y double-spending

### 2. Idempotencia
- `credit_wallet_on_success` verifica `payment_intent_id` duplicado
- `complete_ride` verifica status de pasajeros antes de procesar

### 3. Validaciones de Negocio
- No puedes reservar tu propio viaje
- No puedes reservar si no hay asientos
- No puedes gastar más de tu saldo disponible
- Viajes solo para mujeres verifican género

### 4. Auditoría Completa
- Toda transacción se registra en `wallet_transactions`
- Reembolsos manuales se registran en `refund_logs`
- Payouts se registran en `payout_requests`

---

## 🔧 CONFIGURACIÓN REQUERIDA

### Variables de Entorno (Supabase Edge Functions)
```bash
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
SUPABASE_URL=https://....supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

### Variables de Entorno (Frontend)
```bash
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_...
```

---

## 📊 MONITOREO Y MÉTRICAS

### Consultas Útiles para Admins

#### Balance de Tesorería
```sql
SELECT balance, held_balance, updated_at 
FROM public.wallets 
WHERE user_id = '00000000-0000-0000-0000-000000000000';
```

#### Reembolsos Pendientes de Revisión
```sql
SELECT * FROM public.cancellation_disputes 
WHERE status = 'pending' 
ORDER BY created_at DESC;
```

#### Retiros Pendientes
```sql
SELECT pr.*, p.display_name, p.email 
FROM public.payout_requests pr
JOIN public.profiles p ON pr.user_id = p.id
WHERE pr.status = 'pending'
ORDER BY pr.created_at ASC;
```

#### Transacciones Sospechosas (Grandes Montos)
```sql
SELECT * FROM public.wallet_transactions 
WHERE ABS(amount) > 100 
ORDER BY created_at DESC 
LIMIT 20;
```

---

## 🚨 TROUBLESHOOTING

### Problema: "Saldo insuficiente" pero el usuario tiene dinero
**Causa:** El dinero está en `held_balance` (escrow) de un viaje activo
**Solución:** Verificar viajes activos del usuario y esperar a que se completen o cancelen

### Problema: Comisiones no llegan a la tesorería
**Causa:** Wallet de plataforma no existe
**Solución:** Ejecutar el INSERT de verificación (ver sección 3 de Verificación)

### Problema: Stripe webhook no procesa pagos
**Causa:** `STRIPE_WEBHOOK_SECRET` incorrecto o webhook no configurado
**Solución:** 
1. Ir a Stripe Dashboard → Webhooks
2. Crear webhook apuntando a: `https://[PROJECT].supabase.co/functions/v1/stripe-webhook`
3. Eventos: `payment_intent.succeeded`, `account.updated`
4. Copiar signing secret a variable de entorno

### Problema: Pasajero paga con Stripe pero no aparece en el viaje
**Causa:** Webhook falló o `confirm_stripe_booking` no se ejecutó
**Solución:** 
1. Verificar logs de Edge Function
2. Buscar el `payment_intent_id` en `ride_requests`
3. Llamar manualmente a `confirm_stripe_booking` si es necesario

---

## 📝 NOTAS IMPORTANTES

1. **NUNCA** modifiques directamente `wallet_transactions` - siempre usa los RPCs
2. **SIEMPRE** verifica que la suma de `balance + held_balance` de todos los usuarios coincida con el total esperado
3. **BACKUP** antes de ejecutar migraciones en producción
4. **TESTA** cada flujo en staging antes de desplegar a producción

---

## ✅ CHECKLIST DE DESPLIEGUE

- [ ] Ejecutar scripts en orden correcto
- [ ] Verificar funciones creadas
- [ ] Verificar tablas creadas
- [ ] Crear wallet de tesorería
- [ ] Configurar variables de entorno
- [ ] Configurar Stripe webhook
- [ ] Probar pago con saldo
- [ ] Probar pago con tarjeta
- [ ] Probar cancelación de conductor
- [ ] Probar cancelación de pasajero
- [ ] Probar completar viaje
- [ ] Probar reembolso manual
- [ ] Probar solicitud de retiro
- [ ] Verificar que comisiones llegan a tesorería

---

**Versión:** 4.0  
**Última Actualización:** 2026-02-09  
**Autor:** ShareWay Engineering Team
