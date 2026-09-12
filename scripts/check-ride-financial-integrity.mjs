#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const failures = [];
const warnings = [];

const file = (relativePath) => {
  const fullPath = path.join(root, relativePath);
  if (!fs.existsSync(fullPath)) {
    failures.push(`Falta ${relativePath}`);
    return '';
  }
  return fs.readFileSync(fullPath, 'utf8');
};

const migrationPath = 'supabase/migrations/20260901120000_reconcile_ride_financial_rules.sql';
const sql = file(migrationPath);
const pricing = file('src/utils/pricingRules.js');
const rideService = file('src/services/rideService.js');
const bookingModal = file('src/components/BookingPaymentModal.jsx');
const paymentIntent = file('supabase/functions/create-booking-payment-intent/index.ts');
const webhook = file('supabase/functions/stripe-webhook/index.ts');
const passengerCancellation = file('supabase/functions/cancel-booking-and-refund/index.ts');
const driverCancellation = file('supabase/functions/cancel-ride-and-refund/index.ts');
const topUpIntent = file('supabase/functions/create-payment-intent/index.ts');
const payoutRequest = file('supabase/functions/request-payout/index.ts');
const payoutProcessor = file('supabase/functions/process-stripe-payout/index.ts');
const legacyRefund = file('supabase/functions/process-ride-refund/index.ts');
const noShowFunction = sql;
const bookingService = file('src/services/bookingService.js');

const requireIn = (source, pattern, message) => {
  const found = typeof pattern === 'string' ? source.includes(pattern) : pattern.test(source);
  if (!found) failures.push(message);
};

const requireAll = (source, patterns, scope) => {
  for (const [pattern, description] of patterns) {
    requireIn(source, pattern, `${scope}: falta ${description}`);
  }
};

// This is deliberately a lexical check, not a replacement for PostgreSQL.
// It catches accidentally truncated dollar-quoted functions and unbalanced
// parentheses before a migration reaches a real project.
const checkSqlLexicalIntegrity = (source) => {
  const dollarTags = [...source.matchAll(/\$[A-Za-z_0-9]*\$/g)].map((match) => match[0]);
  if (dollarTags.length % 2 !== 0) {
    failures.push(`${migrationPath}: número impar de etiquetas dollar-quote.`);
  }

  let state = 'normal';
  let dollarTag = null;
  const stack = [];
  let line = 1;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === '\n') line += 1;

    if (state === 'normal') {
      if (source.startsWith('--', index)) {
        state = 'line-comment';
        index += 1;
      } else if (source.startsWith('/*', index)) {
        state = 'block-comment';
        index += 1;
      } else if (char === "'") {
        state = 'single-quote';
      } else if (char === '"') {
        state = 'double-quote';
      } else {
        const tag = source.slice(index).match(/^\$[A-Za-z_0-9]*\$/)?.[0];
        if (tag) {
          dollarTag = tag;
          state = 'dollar-quote';
          index += tag.length - 1;
        } else if (char === '(') {
          stack.push(line);
        } else if (char === ')') {
          if (stack.length === 0) failures.push(`${migrationPath}: ')' sin pareja en línea ${line}.`);
          else stack.pop();
        }
      }
      continue;
    }

    if (state === 'line-comment') {
      if (char === '\n') state = 'normal';
      continue;
    }
    if (state === 'block-comment') {
      if (source.startsWith('*/', index)) {
        state = 'normal';
        index += 1;
      }
      continue;
    }
    if (state === 'single-quote') {
      if (source.startsWith("''", index)) index += 1;
      else if (char === "'") state = 'normal';
      continue;
    }
    if (state === 'double-quote') {
      if (source.startsWith('""', index)) index += 1;
      else if (char === '"') state = 'normal';
      continue;
    }
    if (state === 'dollar-quote' && source.startsWith(dollarTag, index)) {
      state = 'normal';
      index += dollarTag.length - 1;
    }
  }

  if (state !== 'normal') failures.push(`${migrationPath}: SQL termina dentro de ${state}.`);
  if (stack.length > 0) failures.push(`${migrationPath}: ${stack.length} paréntesis sin cerrar.`);
};

if (sql) checkSqlLexicalIntegrity(sql);

requireAll(sql, [
  [/sw_progressive_price\s*\(/i, 'precio progresivo server-side'],
  [/15[\s\S]{0,80}0\.30[\s\S]{0,80}50[\s\S]{0,80}0\.216/i, 'tramos 15/0.30 y 50/0.216'],
  [/200[\s\S]{0,80}0\.144[\s\S]{0,80}500[\s\S]{0,80}0\.108/i, 'tramos 200/0.144 y 500/0.108'],
  [/v_remaining\s*\*\s*0\.084/i, 'tramo excedente a 0.084'],
  [/least\(300/i, 'tope server-side de 300 EUR'],
  [/p_num_seats\s*<\s*1\s+OR\s+p_num_seats\s*>\s*8/i, 'límite server-side de 1..8 plazas'],
  [/pickup_supplement_per_seat/i, 'suplemento de recogida por asiento'],
  [/platform_fee.*0\.10/i, 'importe de comisión platform fee'],
  [/ride_active_seat_count[\s\S]{0,1200}on_board/i, 'helper de plazas alineado con on_board'],
  [/ride_active_seat_count[\s\S]{0,1200}seats_booked/i, 'helper de plazas multi-plaza'],
  [/v_detour_distance\s*>\s*3/i, 'umbral de desvío de 3 km'],
  [/v_ride\.price\s*\/\s*v_ride_distance/i, 'precio proporcional al trayecto personalizado'],
  [/platform_fee_rate.*0\.10/i, 'comisión de plataforma del 10%'],
  [/v_fee\s*:=\s*round\(v_subtotal\s*\*\s*0\.10/i, 'comisión redondeada del 10%'],
  [/v_net_payout\s*:=\s*round\(v_subtotal\s*-\s*v_fee/i, 'liquidación del resto al conductor'],
  [/v_total\s*>\s*2400/i, 'límite server-side de 2400 EUR por cobro'],
  [/v_hours\s*>\s*24/i, 'reembolso total sobre 24 horas'],
  [/v_hours\s*>=\s*2/i, 'reembolso parcial desde 2 horas'],
  [/v_refund_percent\s*:=\s*0\.0/i, 'sin reembolso por debajo de 2 horas'],
  [/v_driver_compensation\s*:=\s*round\(v_penalty_amount\s*\*\s*0\.80/i, 'reparto 80/20 de penalización del pasajero'],
  [/v_driver_compensation_total\s*:=\s*round\(v_penalty\s*\*\s*0\.50/i, 'compensación 50/50 por cancelación del conductor'],
  [/v_penalty\s*:=\s*5\.00/i, 'penalización de 5 EUR del conductor'],
  [/v_penalty\s*:=\s*2\.00/i, 'penalización de 2 EUR del conductor'],
  [/already_completed/i, 'idempotencia de finalización'],
  [/driver_cancellation_refund/i, 'ledger de reembolso por cancelación del conductor'],
  [/driver_cancellation_penalty/i, 'ledger de penalización del conductor'],
  [/passenger_refund/i, 'ledger de reembolso del pasajero'],
  [/passenger_cancellation_penalty/i, 'ledger de penalización del pasajero'],
  [/record_ride_financial_event\(/i, 'helper de auditoría financiera'],
  [/RETURNING\s+id\s+INTO\s+v_tx_id/i, 'referencia de las transacciones al ledger'],
  [/FOR UPDATE/i, 'bloqueo transaccional de filas'],
  [/record_unfulfillable_booking_refund/i, 'recuperación de cobro sin plazas'],
], 'Migración financiera');

requireAll(pricing, [
  [/maxKm:\s*15[\s\S]{0,60}rate:\s*0\.30/, 'configuración 15/0.30'],
  [/maxKm:\s*50[\s\S]{0,60}rate:\s*0\.216/, 'configuración 50/0.216'],
  [/maxKm:\s*200[\s\S]{0,60}rate:\s*0\.144/, 'configuración 200/0.144'],
  [/maxKm:\s*500[\s\S]{0,60}rate:\s*0\.108/, 'configuración 500/0.108'],
  [/rate:\s*0\.084/, 'configuración excedente 0.084'],
  [/calculateBookingTotal\s*=\s*\(/, 'cálculo de total multi-plaza'],
  [/PICKUP_SUPPLEMENT:\s*1\.50/, 'suplemento local de 1.50 EUR'],
  [/PLATFORM_COMMISSION_RATE:\s*0\.10/, 'comisión local del 10%'],
], 'Reglas de precio cliente');

requireAll(rideService, [
  [/calculateSuggestedPrice/, 'adaptador de precio progresivo'],
  [/validateRidePayload/, 'validación de publicación'],
  [/data\.distance/, 'validación de distancia obligatoria'],
  [/recommendedMax/, 'límite frente a precio sugerido'],
], 'rideService');

requireAll(bookingModal, [
  [/supabase\.rpc\(['"]quote_ride_booking['"]/, 'cotización server-side en el modal'],
  [/p_num_seats/, 'plazas en la cotización'],
  [/isQuoteReady/, 'bloqueo de cobro sin cotización server-side'],
  [/quotedPricePerSeat/, 'precio por plaza devuelto por la cotización'],
  [/quotedPlatformFee/, 'comisión monetaria devuelta por la cotización'],
  [/quotedDriverPayout/, 'neto del conductor devuelto por la cotización'],
  [/quoteError/, 'presentación explícita de error de cotización'],
  [/commissionIncluded/, 'indicación de comisión incluida'],
  [/length:\s*Math\.min\(8/, 'selector multi-plaza hasta 8'],
], 'BookingPaymentModal');

requireAll(paymentIntent, [
  [/quote_ride_booking/, 'cotización server-side al crear PaymentIntent'],
  [/expectedTotal/, 'importe esperado server-side'],
  [/expectedPricePerSeat/, 'precio por plaza validado contra la cotización'],
  [/amount:\s*Math\.round\(expectedTotal\s*\*\s*100\)/, 'importe Stripe derivado del servidor'],
  [/booking_signature/, 'firma de cotización'],
  [/payment_intent_id/, 'persistencia del PaymentIntent'],
], 'PaymentIntent Edge Function');

requireAll(webhook, [
  [/fulfill_booking_after_payment/, 'fulfillment del webhook'],
  [/record_unfulfillable_booking_refund/, 'refund automático si el fulfillment falla'],
  [/booking-fulfillment-failure:/, 'idempotencia del refund de recuperación'],
  [/return jsonResponse\(\{[\s\S]{0,180}retryable:\s*true/, 'reintento Stripe ante fallo SQL'],
], 'Stripe webhook');

requireAll(topUpIntent, [
  [/auth\.getUser\(\)/, 'autenticación de recargas'],
  [/payment_intents/, 'intento de recarga persistido antes de cobrar'],
  [/type:\s*'wallet_deposit'/, 'metadato de recarga para el webhook'],
  [/user\.id/, 'identidad derivada del token'],
  [/amount:\s*Math\.round\(amount\s*\*\s*100\)/, 'importe de Stripe normalizado'],
], 'Recarga Stripe');

requireAll(payoutRequest, [
  [/auth\.getUser\(\)/, 'autenticación de retiro'],
  [/rpc\(['"]request_payout['"]/, 'RPC canónica de solicitud'],
  [/p_amount/, 'importe enviado al RPC'],
  [/p_idempotency_key/, 'idempotencia de solicitud de retiro'],
], 'Solicitud de retiro');

requireAll(payoutProcessor, [
  [/auth\.getUser\(\)/, 'autenticación de administrador'],
  [/stripe\.transfers\.create/, 'transferencia Stripe'],
  [/idempotencyKey:\s*`payout:/, 'idempotencia de transferencia'],
  [/rpc\(['"]process_payout['"]/, 'RPC canónica de liquidación'],
  [/stripe_transfer_id/, 'persistencia del identificador Stripe'],
], 'Procesamiento de retiro');

requireIn(sql, /DROP FUNCTION IF EXISTS public\.process_payout_elite/i, 'La migración financiera debe retirar el RPC de payout histórico inseguro.');
requireIn(file('src/pages/Admin/tabs/FinanceTab.jsx'), /processStripePayout/, 'El panel admin debe procesar retiros mediante Edge Function + Stripe.');

requireAll(legacyRefund, [
  [/LEGACY_REFUND_ENDPOINT_DISABLED/, 'endpoint legado deshabilitado'],
  [/auth\.getUser\(\)/, 'autenticación antes de rechazar la ruta'],
], 'Refund legado');

requireAll(passengerCancellation, [
  [/cancel_booking_and_refund/, 'RPC atómica de cancelación'],
  [/transition_financial_status/, 'evidencia persistida de captura antes del refund'],
  [/(?:idempotencyKey\s*:\s*`(?:cancel-booking|stripe-refund):|refundOperationKey)/, 'idempotencia del refund de pasajero'],
  [/hoursUntilDeparture\s*>\s*24/, 'política >24h'],
  [/hoursUntilDeparture\s*>=\s*2/, 'política 2..24h'],
], 'Cancelación pasajero Edge Function');

requireAll(driverCancellation, [
  [/cancel_ride_unified/, 'RPC atómica de cancelación del conductor'],
  [/transition_financial_status/, 'evidencia persistida de captura antes del refund'],
  [/(?:idempotencyKey\s*:\s*`(?:cancel-ride|stripe-refund):|operationKey\s*=\s*`cancel-ride:)/, 'idempotencia de refunds del conductor'],
  [/payment_amount/, 'importe total persistido multi-plaza'],
], 'Cancelación conductor Edge Function');

requireAll(noShowFunction, [
  [/CREATE OR REPLACE FUNCTION public\.handle_passenger_no_show/i, 'manejo canónico de no-show'],
  [/v_total_paid/, 'importe total persistido del no-show'],
  [/v_seats\s*:=\s*v_seats_text::INTEGER/, 'plazas multi-seat del no-show'],
  [/v_platform_fee\s*:=\s*round\(v_total_paid\s*\*\s*0\.10/i, 'comisión del 10% en no-show'],
  [/v_driver_amount\s*:=\s*round\(v_total_paid\s*-\s*v_platform_fee/i, 'liquidación del resto al conductor en no-show'],
  [/no_show_penalty/i, 'ledger de no-show'],
  [/already_processed/i, 'idempotencia del no-show'],
  [/PASSENGER_ALREADY_VERIFIED/i, 'bloqueo de no-show para pasajeros ya verificados'],
], 'No-show financiero');

requireAll(bookingService, [
  [/serverAuthoritative:\s*false/, 'estimación marcada como no autoritativa'],
  [/presentationOnly:\s*true/, 'estimación marcada solo para presentación'],
  [/payment_amount/, 'uso del importe persistido en preview'],
  [/cancelBookingAndRefund/, 'delegación de cancelación al servidor'],
], 'bookingService');

if (/0\.35|0\.20|0\.15/.test(pricing)) {
  warnings.push('pricingRules contiene tasas históricas; comprobar que no sean reglas activas.');
}
if (/fetchRoute/.test(bookingModal)) {
  failures.push('BookingPaymentModal vuelve a calcular el importe principal con una ruta cliente; debe usar quote_ride_booking.');
}

for (const warning of warnings) console.warn(`⚠️  ${warning}`);
if (failures.length > 0) {
  console.error('\n❌ Auditoría financiera de viajes fallida:');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log('✅ Auditoría financiera: precio, cobro, multi-plaza, cancelaciones, ledger, liquidación 90/10 y recuperación Stripe están conectados.');
