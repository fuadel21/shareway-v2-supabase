import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { getCorsHeaders } from "../_shared/cors.ts"

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req)
  const jsonResponse = (payload: unknown, status = 200) => new Response(
    JSON.stringify(payload),
    { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  )

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return jsonResponse({ error: { message: 'No autorizado' } }, 401)

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } },
    )

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser()
    if (userError || !user) return jsonResponse({ error: { message: 'No autorizado' } }, 401)

    const {
      origin,
      destination,
      departure_time,
      seats,
      price,
      details,
      distance,
      overview_polyline,
      waypoints,
      idempotency_key,
      route_data,
    } = await req.json()

    if (!origin || !destination || !departure_time || !seats) {
      return jsonResponse({ error: { message: 'Faltan campos obligatorios' } }, 400)
    }

    const { data, error } = await supabaseClient.rpc('create_ride', {
      p_origin: origin,
      p_destination: destination,
      p_departure_time: departure_time,
      p_seats: seats,
      p_price: price,
      p_details: details || '',
      p_distance: distance ?? route_data?.distance ?? 0,
      p_overview_polyline: overview_polyline || route_data?.overview_polyline || '',
      p_waypoints: waypoints || [],
      p_idempotency_key: idempotency_key || null,
    })

    if (error) throw error

    const payload = Array.isArray(data) ? data[0] : data
    if (payload?.success === false) {
      return jsonResponse({ error: { message: payload.error || payload.message || 'No se pudo crear el viaje' } }, 400)
    }

    return jsonResponse({
      success: true,
      rideId: payload?.rideId || payload?.ride_id || payload?.id,
      data: payload,
    })
  } catch (error) {
    return jsonResponse({ error: { message: error instanceof Error ? error.message : 'Error inesperado' } }, 400)
  }
})
