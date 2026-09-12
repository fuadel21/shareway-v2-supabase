# Guía de despliegue financiero vigente de ShareWay

**Actualizada:** 4 de septiembre de 2026
**Migración única de referencia:** `supabase/migrations/20260901120000_reconcile_ride_financial_rules.sql`

> Los scripts SQL históricos que todavía existen en `supabase/` y
> `supabase/_LEGACY_HISTORY_/` son material de archivo. No deben ejecutarse en
> un proyecto nuevo ni después de la migración canónica: pueden recrear RPCs
> con fórmulas antiguas o abrir rutas financieras que ya fueron retiradas.

## 1. Orden de despliegue

1. Aplicar las migraciones del directorio `supabase/migrations/` en el orden de
   Supabase CLI. La migración `20260901120000...` debe ser la última de esta
   consolidación.
2. Desplegar las Edge Functions vigentes:
   `create-booking-payment-intent`, `create-payment-intent`,
   `stripe-webhook`, `cancel-booking-and-refund`,
   `cancel-ride-and-refund`, `request-payout` y `process-stripe-payout`.
3. Configurar `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
   `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` en el
   entorno de Edge Functions.
4. Registrar en Stripe el webhook `stripe-webhook` con los eventos:
   `payment_intent.succeeded`, `payment_intent.payment_failed`,
   `charge.refunded` y `charge.dispute.created`.
5. Ejecutar las auditorías estáticas del repositorio y probar en Stripe test
   antes de activar cobros reales.

La migración crea/reconcilia `stripe_webhook_events`, el inbox durable que
se reclama con lock, se reintenta si queda fallido y se marca como procesado
solo después de cerrar las transiciones SQL. Un evento duplicado no vuelve a
mover fondos.

## 2. Reglas de negocio desplegables

### Precio y cobro

- Precio publicado: EUR por plaza, entre 0,50 € y 300 €.
- Precio sugerido acumulativo: 0–15 km a 0,30 €/km; 15–50 a 0,216; desde 50 km
  a 0,15 €/km sin límite superior de distancia. Se mantiene el tope global de
  300 € por plaza.
- El conductor puede ofrecer menos que la sugerencia, no más de sugerencia +
  0,05 € por redondeo. Una reserva nueva también rechaza un viaje programado
  legacy cuyo precio almacenado esté por encima de esa banda; no se cambia el
  precio silenciosamente y el viaje debe corregirse antes de volver a aceptar
  reservas.
- Total de reserva: cotización server-side × plazas. El quote usa la distancia
  persistida del viaje, la contrasta con una banda Haversine server-side y
  calcula la distancia personalizada recogida/destino; suma 1,50 € por plaza
  cuando la recogida está a más de 3 km del origen.
- La comisión del 10% está incluida en el bruto mostrado al pasajero; no es
  un cargo adicional. Una liquidación completa es 90% conductor / 10%
  plataforma, usando el remanente redondeado para no perder céntimos.

### Wallet y Stripe

- Wallet: `confirm_trip_and_pay` bloquea el viaje y la wallet, obtiene el quote
  interno y mueve el total a `held_balance`.
- Tarjeta: el navegador solo solicita un PaymentIntent; el webhook comprueba
  el importe recibido y `fulfill_booking_after_payment` vuelve a reconstruir
  el quote contra el viaje y la solicitud almacenada. Stripe no se acredita
  en la wallet del pasajero.
- Recarga: `create-payment-intent` resuelve el precio de los paquetes en
  Stripe o valida un custom de 5–3.000 €. Solo `settle_wallet_deposit`, desde
  el webhook, acredita saldo.
- Retiro: `request_payout` reserva saldo bajo lock. `process-stripe-payout`
  usa `payout:{payoutId}` y `process_payout` para cerrar la transferencia. Si
  el resultado externo es incierto, el reintento usa la misma clave.

### Cancelaciones

- Pasajero: más de 24 h reembolsa 100%; entre 2 h y 24 h reembolsa 50%; por
  debajo de 2 h no reembolsa. La parte no reembolsada se reparte 80%
  conductor / 20% plataforma.
- Conductor: devuelve el 100% de cada reserva activa. Penalización: 5 € por
  debajo de 2 h, 2 € entre 2 h y 24 h y 0 € con 24 h o más. La mitad de la
  penalización se comparte entre pasajeros y el resto va a plataforma, junto
  con la penalización reputacional.
- Los refunds de tarjeta se ejecutan en Edge con claves estables y después se
  pasa a SQL el importe exacto que Stripe confirmó. Un fallo SQL devuelve 5xx
  y permite repetir sin duplicar el refund.

## 3. Seguridad de RPC

- `quote_ride_booking` es el único quote público autenticado; el helper
  interno no tiene grant.
- `fulfill_booking_after_payment`, `settle_wallet_deposit`,
  `record_unfulfillable_booking_refund`, la finalización Stripe de
  `process_payout` y la gestión del inbox Stripe son service-role-only.
  Un administrador autenticado solo puede rechazar una solicitud de retiro.
- `confirm_stripe_booking`, `add_funds`, `process_payment`, `refund_payment`,
  `process_batch_payments`, el escrow genérico y el no-op
  `confirm_passenger_arrival` se revocan para todos los roles. Los wrappers
  directos de cancelación también quedan sin grant autenticado: las Edge
  Functions son la única puerta pública.
- Los importes recibidos del navegador se validan, pero el total, usuario,
  plazas y viaje se derivan de las filas bloqueadas en SQL. El panel de admin
  muestra el saldo real de tesorería y las comisiones del ledger, no una
  proyección de `rides.price`.

## 4. Verificación posterior al despliegue

```bash
node scripts/check-ride-financial-integrity.mjs
node scripts/check-cancellation-seat-refund-integrity.mjs
git diff --check
```

En un entorno con Supabase real comprobar además:

- doble entrega del mismo evento Stripe;
- refund/reintento tras desconectar la llamada SQL;
- carrera de dos reservas para la última plaza;
- reserva y liquidación con 1 y 8 plazas;
- cancelación exactamente a 24 h y 2 h;
- retiro con dos solicitudes concurrentes y reintento después de una
  transferencia aceptada.

Stripe y PostgreSQL no comparten una transacción ACID. El inbox durable,
las claves idempotentes, los locks y los estados auditables reducen ese límite,
pero los eventos `failed` deben monitorizarse y reconciliarse antes de
considerar el sistema totalmente autónomo.
