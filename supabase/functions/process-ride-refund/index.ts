import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import Stripe from "https://esm.sh/stripe@14?target=deno"

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
    httpClient: Stripe.createFetchHttpClient(),
})

serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

    try {
        const supabaseAdmin = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        )

        const { stripe_id, ride_id, user_id } = await req.json()

        if (!stripe_id || !ride_id || !user_id) {
            throw new Error('Parámetros stripe_id, ride_id y user_id son requeridos')
        }

        // 1. Obtener detalles para calcular penalización
        const { data: ride, error: rideError } = await supabaseAdmin
            .from('rides')
            .select('departure_time, driver_id')
            .eq('id', ride_id)
            .single()
            
        const { data: booking, error: bookingError } = await supabaseAdmin
            .from('wallet_transactions')
            .select('amount, created_at')
            .eq('stripe_id', stripe_id)
            .single()

        if (rideError || bookingError || !ride || !booking) {
            throw new Error('Datos de viaje/pago no encontrados en la base de datos')
        }

        // 2. Calcular monto a devolver (Lógica de Penalización)
        const hoursUntilDeparture = (new Date(ride.departure_time).getTime() - Date.now()) / (1000 * 60 * 60)
        const minutesSinceBooking = (Date.now() - new Date(booking.created_at).getTime()) / (1000 * 60)
        
        // Monto original en céntimos (siempre positivo para Stripe)
        let refundAmountCents = Math.abs(Math.round(booking.amount * 100))

        // REGLA DE NEGOCIO:
        // Si el que cancela es el PASAJERO (user_id != ride.driver_id), aplicamos penalizaciones.
        // Si el que cancela es el CONDUCTOR, el reembolso es siempre del 100%.
        if (user_id !== ride.driver_id) {
            if (hoursUntilDeparture < 2) {
                refundAmountCents = 0 // Menos de 2h: Sin reembolso
            } else if (hoursUntilDeparture < 24 && minutesSinceBooking > 15) {
                refundAmountCents = Math.round(refundAmountCents * 0.5) // 50% de devolución si pasaron 15min de la reserva
            }
        }

        // 3. Ejecutar reembolso en Stripe si hay monto que devolver
        let stripeRefundId = null
        if (refundAmountCents > 0) {
            const refund = await stripe.refunds.create({
                payment_intent: stripe_id,
                amount: refundAmountCents,
                reason: 'requested_by_customer',
                metadata: { ride_id, user_id, type: 'ride_cancellation' }
            })
            stripeRefundId = refund.id
        }

        // 4. Actualizar auditoría usando la máquina de estados
        await supabaseAdmin.rpc('transition_financial_status', {
            p_stripe_id: stripe_id,
            p_new_status: refundAmountCents > 0 ? 'refunded' : 'failed',
            p_metadata: { 
                refund_id: stripeRefundId, 
                actual_refunded_amount: refundAmountCents / 100,
                penalty_applied: (Math.abs(booking.amount * 100) - refundAmountCents) / 100,
                processed_at: new Date().toISOString()
            }
        })

        return new Response(JSON.stringify({ 
            success: true, 
            refunded: refundAmountCents / 100,
            stripe_refund_id: stripeRefundId 
        }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200,
        })

    } catch (error) {
        console.error(`🚨 process-ride-refund Error: ${error.message}`)
        return new Response(JSON.stringify({ error: error.message }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 400,
        })
    }
})
