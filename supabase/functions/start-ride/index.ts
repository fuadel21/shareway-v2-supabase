import { getCorsHeaders } from '../_shared/cors.ts'
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"



serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: getCorsHeaders(req) })
    }

    try {
        const supabaseClient = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_ANON_KEY') ?? '',
            { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
        )

        const { data: { user }, error: authError } = await supabaseClient.auth.getUser()
        if (authError || !user) throw new Error('No autorizado')

        const { rideId, pin } = await req.json()

        if (!rideId || !pin) {
            throw new Error('Faltan parámetros: rideId o pin')
        }

        // 1. Verificar que el usuario sea el conductor de este viaje
        const { data: ride, error: rideError } = await supabaseClient
            .from('rides')
            .select('driver_id, status')
            .eq('id', rideId)
            .single()

        if (rideError || !ride) throw new Error('Viaje no encontrado')
        if (ride.driver_id !== user.id) throw new Error('No eres el conductor de este viaje')
        if (ride.status !== 'scheduled') throw new Error('El viaje ya ha sido iniciado o finalizado')

        // 2. Verificar que el PIN coincida con ALGÚN pasajero aceptado
        const { data: requests, error: reqError } = await supabaseClient
            .from('ride_requests')
            .select('id, passenger_id, pin')
            .eq('ride_id', rideId)
            .eq('status', 'accepted')

        if (reqError) throw reqError
        if (!requests || requests.length === 0) throw new Error('No hay pasajeros confirmados para este viaje')

        const validPin = requests.some(r => r.pin === pin)

        if (!validPin) {
            throw new Error('El PIN introducido no es válido para ningún pasajero de este viaje')
        }

        // 3. Activar el viaje
        const { error: updateError } = await supabaseClient
            .from('rides')
            .update({ status: 'active' })
            .eq('id', rideId)

        if (updateError) throw updateError

        return new Response(JSON.stringify({ success: true, message: 'Viaje iniciado correctamente' }), {
            headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
            status: 200,
        })

    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
            headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
            status: 400,
        })
    }
})
