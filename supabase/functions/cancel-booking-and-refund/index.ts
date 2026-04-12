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

        // 1. Obtener la reserva validada del pasajero
        const { data: ride, error: rideError } = await supabaseClient
            .from('rides')
            .select('*')
            .eq('id', rideId)
            .single()

        if (rideError || !ride) throw new Error('Viaje no encontrado')
        
        const pax = ride.passengers?.find((p: any) => p.id === user.id && ['confirmed','verified','confirmed_by_pin'].includes(p.status));
        if (!pax) throw new Error('No tienes una reserva confirmada en este viaje')

        let stripeRefunded = 0;

        // 2. Procesar reembolso en Stripe SI existe pago previo y no se pierde por penalización
        if (pax.payment_intent_id && pax.payment_intent_id.startsWith('pi_')) {
            const hoursUntilDeparture = (new Date(ride.departure_time).getTime() - Date.now()) / 3600000;
            const bookedPrice = parseFloat(pax.booked_price);
            
            let refundRatio = 1.0;
            if (hoursUntilDeparture <= 24 && hoursUntilDeparture >= 2) {
                const minsSinceBooked = (Date.now() - new Date(pax.booked_at).getTime()) / 60000;
                if (!(minsSinceBooked <= 15 && hoursUntilDeparture > 3)) {
                   refundRatio = 0.5;
                }
            } else if (hoursUntilDeparture < 2) {
                refundRatio = 0.0;
            }
            
            const totalRefund = bookedPrice * refundRatio;
            
            if (totalRefund > 0) {
                try {
                    const pi = await stripe.paymentIntents.retrieve(pax.payment_intent_id);
                    const stripeCharge = pi.amount / 100;
                    const amountToRefundStripe = Math.min(totalRefund, stripeCharge);
                    
                    if (amountToRefundStripe > 0) {
                        await stripe.refunds.create({
                            payment_intent: pax.payment_intent_id,
                            amount: Math.round(amountToRefundStripe * 100)
                        });
                        stripeRefunded = Math.round(amountToRefundStripe * 100) / 100;
                        console.log(`🤑 Stripe refund exitoso: ${stripeRefunded}€`);
                    }
                } catch (stripeError) {
                    console.error('Error al procesar reembolso en Stripe:', stripeError);
                }
            }
        }

        // 3. Destruir el asiento en base de datos y gestionar saldos de Wallet (Escrow)
        const { data: rpcResult, error: rpcError } = await supabaseClient.rpc('cancel_booking_and_refund', {
            p_ride_id: rideId,
            p_stripe_refunded: stripeRefunded
        });

        if (rpcError) throw rpcError;

        return new Response(JSON.stringify({ success: true, message: 'Cancelación procesada', stripeRefunded, details: rpcResult }), {
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
