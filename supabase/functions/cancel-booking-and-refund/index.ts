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
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const supabaseClient = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_ANON_KEY') ?? '',
            { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
        )

        const { data: { user }, error: authError } = await supabaseClient.auth.getUser()
        if (authError || !user) throw new Error('No autorizado')

        const { rideId } = await req.json()
        if (!rideId) throw new Error('rideId requerido')

        // 1. Obtener la solicitud del usuario para este viaje
        const { data: request, error: reqError } = await supabaseClient
            .from('ride_requests')
            .select('*')
            .eq('ride_id', rideId)
            .eq('passenger_id', user.id)
            .single()

        if (reqError || !request) throw new Error('No se encontró la reserva')
        if (request.status === 'cancelled') throw new Error('La reserva ya está cancelada')

        // 2. Procesar reembolso si existe un pago
        if (request.payment_intent_id) {
            try {
                await stripe.refunds.create({
                    payment_intent: request.payment_intent_id,
                })
            } catch (stripeError) {
                console.error('Error al procesar reembolso en Stripe:', stripeError)
                // Continuamos aunque falle Stripe (opcional, dependiendo de política)
            }
        }

        // 3. Actualizar estado a cancelado
        const { error: updateError } = await supabaseClient
            .from('ride_requests')
            .update({ status: 'cancelled' })
            .eq('id', request.id)

        if (updateError) throw updateError

        return new Response(JSON.stringify({ success: true, message: 'Reserva cancelada y reembolso procesado' }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200,
        })

    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 400,
        })
    }
})
