import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { getCorsHeaders } from "../_shared/cors.ts"

const MIN_PRICE = 0.50
const MAX_PRICE = 300
const MAX_SEATS = 8

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

    const requestedSeats = Number(seats)
    const requestedPrice = Number(price)
    const requestedDistance = Number(distance ?? route_data?.distance)

    if (!origin || !destination || !departure_time) {
      return jsonResponse({ error: { message: 'Faltan campos obligatorios' } }, 400)
    }
    if (!Number.isInteger(requestedSeats) || requestedSeats < 1 || requestedSeats > MAX_SEATS) {
      return jsonResponse({ error: { message: 'Número de plazas no válido' } }, 400)
    }
    if (!Number.isFinite(requestedPrice) || requestedPrice < MIN_PRICE || requestedPrice > MAX_PRICE) {
      return jsonResponse({ error: { message: 'Precio por plaza no válido' } }, 400)
    }
    if (!Number.isFinite(requestedDistance) || requestedDistance <= 0) {
      return jsonResponse({ error: { message: 'La distancia de la ruta es obligatoria' } }, 400)
    }

    // Price and seats are validated again by the SECURITY DEFINER RPC. This
    // boundary intentionally forwards only normalized values, never a client
    // supplied booking total or payout amount.
    const { data, error } = await supabaseClient.rpc('create_ride', {
      p_origin: origin,
      p_destination: destination,
      p_departure_time: departure_time,
      p_seats: requestedSeats,
      p_price: requestedPrice,
      p_details: details || '',
      p_distance: requestedDistance,
      p_overview_polyline: overview_polyline || route_data?.overview_polyline || '',
      p_waypoints: waypoints || route_data?.waypoints || [],
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
    console.error('create-ride:', error)
    return jsonResponse({ error: { message: error instanceof Error ? error.message : 'Error inesperado' } }, 400)
  }
})
