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
        const authHeader = req.headers.get('Authorization')!
        const supabaseClient = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_ANON_KEY') ?? '',
            { global: { headers: { Authorization: authHeader } } }
        )

        const { data: { user }, error: userError } = await supabaseClient.auth.getUser()
        if (userError || !user) throw new Error('No autorizado')

        const { rideId } = await req.json()
        if (!rideId) throw new Error('ID del viaje requerido')

        // 1. Obtener detalles del viaje
        const { data: ride, error: rideError } = await supabaseClient
            .from('rides')
            .select('*')
            .eq('id', rideId)
            .single()

        if (rideError || !ride) throw new Error('Viaje no encontrado')
        if (ride.driver_id === user.id) throw new Error('No puedes reservar tu propio viaje')
        if (ride.status !== 'scheduled') throw new Error('Este viaje no está disponible')

        // 2. Verificar disponibilidad (contar solicitudes aceptadas)
        const { count, error: countError } = await supabaseClient
            .from('ride_requests')
            .select('*', { count: 'exact', head: true })
            .eq('ride_id', rideId)
            .eq('status', 'accepted')

        if (countError) throw countError
        if (count !== null && count >= ride.seats) throw new Error('No hay asientos disponibles')

        const amountInCents = Math.round(ride.price * 100)

        // 3. Si el viaje es gratuito, confirmar directamente
        if (amountInCents <= 0) {
            const pin = Math.floor(1000 + Math.random() * 9000).toString()
            const { error: insertError } = await supabaseClient
                .from('ride_requests')
                .insert([{ ride_id: rideId, passenger_id: user.id, status: 'accepted', pin: pin }])

            if (insertError) throw insertError
            return new Response(JSON.stringify({ success: true, requiresPayment: false }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 200,
            })
        }

        // 4. Crear Payment Intent en Stripe
        const paymentIntent = await stripe.paymentIntents.create({
            amount: amountInCents,
            currency: 'eur',
            automatic_payment_methods: { enabled: true },
            metadata: { rideId, passengerId: user.id, type: 'ride_booking' }
        })

        // 5. Generar PIN de 4 dígitos
        const pin = Math.floor(1000 + Math.random() * 9000).toString()

        // 6. Crear solicitud en estado pendiente
        const { error: insertError } = await supabaseClient
            .from('ride_requests')
            .upsert([{
                ride_id: rideId,
                passenger_id: user.id,
                status: 'pending',
                payment_intent_id: paymentIntent.id,
                pin: pin
            }], { onConflict: 'ride_id,passenger_id' })

        if (insertError) throw insertError

        return new Response(JSON.stringify({ requiresPayment: true, clientSecret: paymentIntent.client_secret }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200,
        })

    } catch (error) {
        return new Response(JSON.stringify({ error: { message: error.message } }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 400,
        })
    }
})
