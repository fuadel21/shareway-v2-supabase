import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
    // Manejo de CORS (Preflight)
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        // 1. Inicializar cliente Supabase con el token del usuario
        const authHeader = req.headers.get('Authorization')!
        const supabaseClient = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_ANON_KEY') ?? '',
            { global: { headers: { Authorization: authHeader } } }
        )

        // 2. Obtener el usuario autenticado
        const { data: { user }, error: userError } = await supabaseClient.auth.getUser()
        if (userError || !user) throw new Error('No autorizado')

        // 3. Procesar el cuerpo de la solicitud
        const { origin, destination, departure_time, seats, price, details, route_data, isWomenOnly } = await req.json()

        // Validaciones básicas
        if (!origin || !destination || !departure_time || !seats) {
            return new Response(JSON.stringify({ error: { message: 'Faltan campos obligatorios' } }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 400,
            })
        }

        // 4. Insertar el viaje en la base de datos
        const { data, error } = await supabaseClient
            .from('rides')
            .insert([
                {
                    driver_id: user.id,
                    origin,
                    destination,
                    departure_time,
                    seats,
                    price,
                    details,
                    route_data,
                    is_women_only: !!isWomenOnly,
                    status: 'scheduled'
                }
            ])
            .select()
            .single()

        if (error) throw error

        return new Response(JSON.stringify({ success: true, rideId: data.id }), {
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
