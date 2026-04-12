import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

    try {
        const supabaseClient = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_ANON_KEY') ?? '',
            { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
        )

        const { rideId, paxOrigin, paxDestination } = await req.json()

        if (!rideId || !paxOrigin?.lat || !paxOrigin?.lng || !paxDestination?.lat || !paxDestination?.lng) {
            throw new Error('rideId, y coordenadas válidas para paxOrigin y paxDestination son requeridos')
        }

        // 1. Obtener datos del viaje original
        const { data: ride, error: rideError } = await supabaseClient
            .from('rides')
            .select('origin, destination, distance, price')
            .eq('id', rideId)
            .single()

        if (rideError || !ride) throw new Error('Viaje no encontrado')

        // Coordenadas del conductor
        const driverOrigin = ride.origin.coordinates || ride.origin
        const driverDest = ride.destination.coordinates || ride.destination

        // 2. Llamar a OSRM para calcular la ruta CON el desvío
        // Ruta: Driver Origin -> Pax Origin -> Pax Destination -> Driver Destination
        const coords = [
            `${driverOrigin.lng},${driverOrigin.lat}`,
            `${paxOrigin.lng},${paxOrigin.lat}`,
            `${paxDestination.lng},${paxDestination.lat}`,
            `${driverDest.lng},${driverDest.lat}`
        ].join(';')

        const osrmRes = await fetch(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=false`)
        const osrmData = await osrmRes.json()

        if (osrmData.code !== 'Ok') {
            throw new Error('Error al calcular la ruta con OSRM')
        }

        const routeWithPax = osrmData.routes[0]
        const distWithPaxKm = routeWithPax.distance / 1000
        const originalDistKm = parseFloat(ride.distance)

        // 3. Calcular el Desvío (Detour)
        const detourKm = Math.max(0, distWithPaxKm - originalDistKm)
        
        // 4. Lógica de Precios Dinámicos
        // Distancia que recorre el pasajero
        const paxTravelRes = await fetch(`https://router.project-osrm.org/route/v1/driving/${paxOrigin.lng},${paxOrigin.lat};${paxDestination.lng},${paxDestination.lat}?overview=false`)
        const paxTravelData = await paxTravelRes.json()

        if (paxTravelData.code !== 'Ok' || !paxTravelData.routes || paxTravelData.routes.length === 0) {
            throw new Error('Error al calcular la ruta del pasajero con OSRM')
        }

        const paxDistKm = paxTravelData.routes[0].distance / 1000

        // Tarifas (según requerimiento previo)
        let ratePerKm = 0.25
        if (paxDistKm > 400) ratePerKm = 0.14
        else if (paxDistKm > 100) ratePerKm = 0.17

        // Penalización por desvío (ej. 0.30€ por km extra para el conductor)
        const detourPenaltyRate = 0.30 

        const basePrice = paxDistKm * ratePerKm
        const detourCost = detourKm * detourPenaltyRate
        const totalPrice = basePrice + detourCost

        return new Response(JSON.stringify({
            success: true,
            originalDistance: originalDistKm,
            newTotalDistance: distWithPaxKm,
            detourKm: detourKm.toFixed(2),
            paxDistance: paxDistKm.toFixed(2),
            pricing: {
                basePrice: basePrice.toFixed(2),
                detourCost: detourCost.toFixed(2),
                totalPrice: Math.max(0.50, totalPrice).toFixed(2), // Mínimo 0.50€
                currency: 'EUR'
            }
        }), {
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
