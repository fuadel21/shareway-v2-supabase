import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import Stripe from 'https://esm.sh/stripe@14?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ============================================================================
// SHAREWAY · stripe-reconcile (conciliación periódica con Stripe)
// ============================================================================
// Red de seguridad: el cron de la BD (pg_cron) la invoca cada 15 minutos.
// Compara los pagos y reembolsos reales de Stripe (ventana de 2 h) con el
// estado de la base de datos y aplica las operaciones que el webhook no
// hubiera procesado (entregas perdidas, incidentes de plataforma, etc.).
//
// Todo es idempotente: las RPC ya procesadas responden already_processed y
// no se repiten. Solo procesa depósitos de cartera (wallet_deposit); los
// pagos de reserva siguen la ruta del webhook.
// ============================================================================

const WEBHOOK_SECRET = 'shareway-bookings-2026' // igual que los triggers de la BD
const WINDOW_SECONDS = 2 * 60 * 60 // 2 horas (8 oportunidades por pago con cron de 15 min)

const jsonResponse = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok')

  // Solo el cron de la BD (o el admin con el secreto compartido) puede llamarla
  if (req.headers.get('x-sw-webhook') !== WEBHOOK_SECRET) {
    return jsonResponse({ error: 'unauthorized' }, 401)
  }

  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')
  if (!stripeKey) return jsonResponse({ error: 'STRIPE_SECRET_KEY ausente' }, 503)

  const stripe = new Stripe(stripeKey, {
    httpClient: Stripe.createFetchHttpClient(),
  })
  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  const since = Math.floor(Date.now() / 1000) - WINDOW_SECONDS
  const summary = {
    ok: true,
    window_since: since,
    payments_checked: 0,
    settled: 0,
    already_ok: 0,
    missing_locally: 0,
    refunds_checked: 0,
    reversed: 0,
    already_reversed: 0,
    booking_refunds_skipped: 0,
    errors: [] as string[],
  }

  try {
    // ---------------------------------------------------------------
    // 1) Pagos succeeded en la ventana → asegurar que la cartera los tiene
    // ---------------------------------------------------------------
    const intents = await stripe.paymentIntents.list({
      created: { gte: since },
      limit: 100,
    })

    for (const pi of intents.data) {
      if (pi.status !== 'succeeded') continue
      if ((pi.metadata || {}).type !== 'wallet_deposit') continue
      summary.payments_checked++

      const { data, error } = await supabaseAdmin.rpc('settle_wallet_deposit', {
        p_external_id: pi.id,
        p_paid_amount: Number(pi.amount || 0) / 100,
        p_stripe_event_id: `reconcile:${pi.id}`,
      })
      const payload = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null

      if (error || payload?.success === false) {
        const code = String(payload?.error || error?.message || 'UNKNOWN')
        if (code === 'DEPOSIT_INTENT_NOT_FOUND') {
          summary.missing_locally++ // el PI nunca se registró localmente
        } else if (code === 'DEPOSIT_NOT_PENDING') {
          summary.already_ok++ // ya completado o ya reembolsado
        } else {
          summary.errors.push(`${pi.id}: ${code}`)
        }
      } else if (payload?.already_processed) {
        summary.already_ok++
      } else {
        summary.settled++
        console.log(`[reconcile] acreditado tarde: ${pi.id} ${Number(pi.amount) / 100} EUR`)
      }
    }

    // ---------------------------------------------------------------
    // 2) Reembolsos succeeded en la ventana → asegurar reversión de cartera
    // ---------------------------------------------------------------
    const refunds = await stripe.refunds.list({
      created: { gte: since },
      limit: 100,
    })

    for (const r of refunds.data) {
      if (r.status !== 'succeeded') continue
      const piId = typeof r.payment_intent === 'string'
        ? r.payment_intent
        : (r.payment_intent as { id?: string } | null)?.id
      if (!piId) continue
      summary.refunds_checked++

      const { data, error } = await supabaseAdmin.rpc('reverse_wallet_deposit_refund', {
        p_external_id: piId,
        p_refund_amount: Number(r.amount || 0) / 100,
        p_stripe_event_id: `reconcile:${r.id}`,
      })
      const payload = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null

      if (error || payload?.success === false) {
        summary.errors.push(`${r.id}: ${String(payload?.error || error?.message)}`)
      } else if (payload?.already_processed) {
        summary.already_reversed++
      } else if (payload?.handled) {
        summary.reversed++
        console.log(`[reconcile] reversión tardía: ${piId} ${Number(r.amount) / 100} EUR`)
      } else {
        summary.booking_refunds_skipped++ // pago de reserva: ruta del webhook
      }
    }

    summary.ok = summary.errors.length === 0
    return jsonResponse(summary)
  } catch (error) {
    console.error('[reconcile] fallo:', error)
    return jsonResponse({ ok: false, error: String(error), ...summary }, 500)
  }
})
