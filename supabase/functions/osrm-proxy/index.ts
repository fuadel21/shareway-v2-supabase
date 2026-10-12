import { getCorsHeaders } from '../_shared/cors.ts'
import { requireUser, unauthorized } from '../_shared/auth.ts'
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"



serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: getCorsHeaders(req) })

    const user = await requireUser(req)
    if (!user) return unauthorized(getCorsHeaders(req) as Record<string, string>)

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
            headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
            status: 200,
        });

    } catch (error) {
        return new Response(JSON.stringify({ error: error.message, code: 'ERROR' }), {
            headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
            status: 200, // Siempre 200 para que el frontend maneje el JSON de error
        });
    }
})
