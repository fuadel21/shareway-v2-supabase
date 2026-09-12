# Auditoría financiera vigente de ShareWay

**Fecha de actualización:** 2 de septiembre de 2026
**Fuente de verdad:** `supabase/migrations/20260901120000_reconcile_ride_financial_rules.sql`

> Este documento sustituye el diagnóstico histórico de enero de 2026. Los
> documentos archivados pueden conservar porcentajes o fórmulas antiguas, pero
> no describen el comportamiento desplegable actual.

## Decisiones canónicas

- El precio publicado y el precio mostrado al pasajero son **EUR por plaza**.
- La comisión de plataforma está **incluida** en el precio bruto mostrado; no
  se añade un cargo separado al pasajero.
- El servidor calcula y valida el total a partir del viaje almacenado, las
  coordenadas del trayecto personalizado y las plazas solicitadas. El importe
  enviado por el navegador es únicamente una comprobación contra la cotización
  del servidor.
- El reparto de una liquidación completada es **90% conductor / 10%
  plataforma**. El fee es el remanente redondeado a céntimos, por lo que
  conductor + plataforma siempre coincide con el bruto.

## Precio y reservas

La fórmula progresiva por distancia de la ruta publicada es acumulativa. La tarifa desde 50 km queda fijada en 0,15 €/km sin límite superior de distancia:

| Tramo | Tarifa marginal |
|---|---:|
| 0–15 km | 0,30 €/km |
| 15–50 km | 0,216 €/km |
| Más de 50 km | 0,15 €/km, sin límite superior de distancia |

El precio por plaza queda limitado a 0,50–300,00 €. Se permite una oferta
inferior a la sugerencia y una tolerancia de 0,05 € por redondeo, pero no una
subida superior. La ruta y la distancia recibidas del cliente se comprueban
con las coordenadas guardadas; no se acepta una distancia fabricada fuera del
rango razonable.

Para reservar:

```text
precio_por_plaza = precio_del_viaje / distancia_del_viaje * distancia_del_pasajero
                   + suplemento_de_recogida
importe_total     = precio_por_plaza * número_de_plazas
```

La distancia del pasajero y el desvío se derivan en SQL. Si la recogida está a
más de 3 km del origen del conductor, el suplemento es 1,50 € por plaza. El
mismo quote (`quote_ride_booking`) se usa para la vista previa, la wallet, el
PaymentIntent y el webhook; la interfaz solo presenta una copia de ese quote.

Las reservas multi-plaza persisten `requested_seats`/`seats_booked` y el
PaymentIntent se crea por el importe total. El webhook vuelve a comprobar
plazas, importe y coordenadas antes de incorporar al pasajero.

## Cancelación del pasajero

Sobre el importe realmente almacenado de la reserva (precio por plaza ×
plazas):

- Más de 24 h: reembolso 100%, penalización 0%.
- Entre 2 h y 24 h, incluidos los límites: reembolso 50%, penalización 50%.
- Menos de 2 h: reembolso 0%, penalización 100%.

La parte no reembolsada se reparte 80% al conductor y 20% a la plataforma.
Wallet y tarjeta usan la misma transición SQL. Para tarjeta, Stripe se
reembolsa antes de cerrar la transición y se pasa a SQL el importe exacto;
la clave estable de Stripe permite repetir la operación sin duplicar el
reembolso.

## Cancelación del conductor

Se reembolsa el 100% del importe de cada pasajero activo. La penalización del
conductor es:

- Menos de 2 h: 5 €.
- Entre 2 h y 24 h: 2 €.
- 24 h o más: 0 €.

La mitad de la penalización se reparte entre los pasajeros activos y el resto
va a la plataforma, conservando el remanente de redondeo. Además, una
penalización económica aplica -20 trust/-0,5 rating con menos de 2 h y -10
trust/-0,2 rating en el resto de ventanas penalizadas.

## Finalización y no-show

- `complete_ride` y `complete_passenger_dropoff` pagan una única vez y marcan
  el pasajero como `completed` dentro de la misma transacción.
- Los pagos Stripe nunca vuelven a acreditarse en la wallet del pasajero; el
  conductor recibe su liquidación interna 90/10 y puede retirarla por el flujo
  Stripe Connect.
- El no-show solo puede registrarse cuando ha llegado la hora de salida, con
  el viaje activo, antes de verificar o marcar al pasajero a bordo. Liquida el
  bruto 90/10, elimina sus plazas ocupadas, aplica -15 trust y es idempotente.

## Atomicidad, auditoría e idempotencia

- Las funciones financieras bloquean la fila de `rides` y las wallets
  relevantes con `FOR UPDATE`.
- El ledger `ride_financial_ledger` y `transactions` registran bruto, fee,
  pago al conductor, reembolso, método, plazas e identificadores externos.
- Las reejecuciones de webhook, cancelación, no-show, finalización y retiro
  devuelven el resultado ya procesado en vez de mover fondos otra vez.
- `request_payout` reserva saldo antes de crear la solicitud y usa una clave
  única por usuario. Stripe Connect usa una clave estable por solicitud.
- El endpoint client-callable histórico `confirm_stripe_booking` y el RPC de
  recarga directa `add_funds` quedan deshabilitados. El webhook es la única
  vía que confirma un cobro Stripe de reserva y `create-payment-intent` es la
  única vía de recarga.

## Limitaciones operativas conocidas

Stripe y PostgreSQL no comparten una transacción ACID. Por eso los endpoints
usan claves idempotentes, estados persistidos y respuestas 5xx/reintentos del
webhook cuando falla el cierre SQL. Antes de producción debe observarse y
reconciliarse cualquier transferencia/refund externo cuyo cierre interno
quede pendiente; una prueba con Stripe real sigue siendo necesaria además de
las pruebas PGlite/estáticas.

## Validación local ejecutada

- `node /tmp/validate-shareway-migration.mjs`
- `node scripts/check-ride-financial-integrity.mjs`
- `git diff --check`

Las tres comprobaciones pasan. Lint, tests y build deben ejecutarse con las
dependencias del proyecto disponibles; el script `pnpm run lint` no pudo
iniciarse en este entorno porque no hay binario `pnpm` instalado.
