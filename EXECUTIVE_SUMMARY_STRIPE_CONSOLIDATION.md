# Resumen ejecutivo vigente: pagos Stripe y liquidaciones

**Actualizado:** 2 de septiembre de 2026
**Migración canónica:** `supabase/migrations/20260901120000_reconcile_ride_financial_rules.sql`

> Este resumen sustituye el informe histórico que describía un 15%, una
> liquidación 85/15 y el RPC client-callable `confirm_stripe_booking`. Esos
> caminos no son parte del flujo vigente.

## Reglas financieras

- El precio publicado es **por plaza** y sigue los tramos progresivos:
  0–15 km: 0,30 €/km; 15–100: 0,22; desde 100 km: 0,15 €/km sin límite
  superior de distancia. Se mantiene el tope global de 300 € por plaza.
- El precio por plaza está entre 0,50 € y 300 €. Se permite una oferta inferior
  a la sugerencia y una tolerancia de 0,05 € por redondeo.
- La comisión del 10% está incluida en el precio bruto mostrado al pasajero;
  no se suma como cargo independiente.
- El total de la reserva es la cotización segura del servidor multiplicada por
  las plazas. El servidor deriva la distancia del trayecto personalizado y
  aplica 1,50 € por plaza cuando la recogida está a más de 3 km del origen.
- Una liquidación completada conserva el bruto: 90% al conductor y 10% a la
  plataforma, con el fee como remanente redondeado a céntimos.

## Pago de reserva con tarjeta

```text
BookingPaymentModal
  -> quote_ride_booking (preview server-side)
  -> create-booking-payment-intent (recalcula y valida total/plazas)
  -> Stripe PaymentIntent
  -> stripe-webhook payment_intent.succeeded
  -> fulfill_booking_after_payment (service role, idempotente)
  -> pasajero confirmado + ledger auditable
```

El cliente puede enviar un importe para comprobar que su vista no quedó
obsoleta, pero el PaymentIntent siempre usa el quote del servidor. El webhook
vuelve a validar importe, plazas, viaje y PaymentIntent antes de incorporar al
pasajero. El antiguo `confirm_stripe_booking` se elimina porque permitía
intentar confirmar desde el cliente sin probar que Stripe hubiera capturado el
cobro.

## Pago con wallet

```text
confirm_trip_and_pay
  -> bloquea ride y wallet
  -> obtiene quote_ride_booking
  -> balance -> held_balance por el total
  -> persiste seats_booked y booking_hold en el ledger
```

La wallet no recibe el importe de una reserva Stripe. Al completar, no se
acredita dos veces: se liquida el bruto almacenado de cada reserva, y solo se
libera `held_balance` cuando el origen fue wallet.

## Cancelaciones y no-show

- Pasajero: más de 24 h 100%; entre 2 h y 24 h 50%; menos de 2 h 0%.
  La parte no reembolsada se reparte 80% conductor / 20% plataforma.
- Conductor: reembolso total de pasajeros activos; penalización 5 € (<2 h),
  2 € (2–24 h) o 0 € (24 h o más). La mitad se reparte entre pasajeros y el
  resto va a plataforma; además se actualiza la reputación según la ventana.
- No-show: solo desde la hora de salida y antes de verificar al pasajero; el
  bruto se liquida 90/10, se persiste el evento y el reintento es un no-op.

Los importes se derivan de `booked_price`, `payment_amount` y las plazas
persistidas. Para tarjeta, las Edge Functions ejecutan el refund Stripe con
una clave estable y entregan a SQL el importe externo exacto; SQL no acredita
una wallet como sustituto del refund.

## Recargas y retiros

- Recarga: `create-payment-intent` solo admite los cuatro Price IDs publicados
  o un importe custom entre 5 € y 3.000 €, persiste `payment_intents` y solo
  el webhook `settle_wallet_deposit` acredita la wallet.
- Retiro: `request_payout` deriva el usuario del JWT, bloquea la wallet,
  reserva el saldo y es idempotente por usuario/clave. El administrador usa
  `process-stripe-payout`, que crea la transferencia con una clave estable y
  cierra `process_payout`.
- La auditoría combina `transactions` y `ride_financial_ledger`, incluyendo
  bruto, fee, payout, refunds, plazas y los identificadores de Stripe.

## Garantías y límite conocido

Las transiciones SQL bloquean las filas críticas y son atómicas. Stripe y
PostgreSQL no comparten una transacción ACID: si Stripe confirma un refund o
transferencia y el cierre SQL falla, la clave de Stripe permite repetir el
llamado y el webhook/endpoint devuelve 5xx para reintentar. Debe existir
monitorización y reconciliación de esos estados pendientes antes de declarar
la operación completamente autónoma.
