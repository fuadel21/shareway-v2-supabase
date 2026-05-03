import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

    try {
        let coords, overview, geometries;
        const body = await req.json().catch(() => ({}));

        coords = body.coords || body.coordinates;
        overview = body.overview || 'full';
        geometries = body.geometries || 'polyline';

        if (!coords) throw new Error('Missing coords');

        // Solo usamos el proveedor más estable para evitar timeouts acumulados
        const url = `https://routing.openstreetmap.de/routed-car/route/v1/driving/${coords}?overview=${overview}&geometries=${geometries}`;

        const response = await fetch(url, {
            headers: { "User-Agent": "ShareWayProxy/1.0" }
        });

        const data = await response.json();
        return new Response(JSON.stringify(data), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200,
        });

    } catch (error) {
        return new Response(JSON.stringify({ error: error.message, code: 'ERROR' }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200, // Siempre 200 para que el frontend maneje el JSON de error
        });
    }
})
