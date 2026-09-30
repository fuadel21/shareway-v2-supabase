import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'

const getCoordinate = (location: any, axis: 'lat' | 'lng') => {
  const value = location?.[axis]
    ?? location?.coordinates?.[axis]
    ?? location?.coordinates?.[axis === 'lat' ? 'latitude' : 'longitude']
    ?? location?.[axis === 'lat' ? 'latitude' : 'longitude']
  const coordinate = Number(value)
  return Number.isFinite(coordinate) ? coordinate : null
}

const jsonResponse = (payload: unknown, headers: Record<string, string>, status = 200) => new Response(
  JSON.stringify(payload),
  { status, headers: { ...headers, 'Content-Type': 'application/json' } },
)

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Método no permitido' }, corsHeaders, 405)

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return jsonResponse({ error: 'No autorizado' }, corsHeaders, 401)

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } },
    )
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser()
    if (authError || !user) return jsonResponse({ error: 'No autorizado' }, corsHeaders, 401)

    const { rideId, paxOrigin, paxDestination, numSeats = 1 } = await req.json()
    if (typeof rideId !== 'string' || !rideId.trim()) {
      return jsonResponse({ error: 'rideId es obligatorio' }, corsHeaders, 400)
    }

    const pickupLocation = {
      ...paxOrigin,
      lat: getCoordinate(paxOrigin, 'lat'),
      lng: getCoordinate(paxOrigin, 'lng'),
    }
    const dropoffLocation = {
      ...paxDestination,
      lat: getCoordinate(paxDestination, 'lat'),
      lng: getCoordinate(paxDestination, 'lng'),
    }
    if (![pickupLocation.lat, pickupLocation.lng, dropoffLocation.lat, dropoffLocation.lng].every(Number.isFinite)) {
      return jsonResponse({ error: 'Coordenadas válidas para origen y destino son obligatorias' }, corsHeaders, 400)
    }

    const requestedSeats = Number(numSeats)
    if (!Number.isInteger(requestedSeats) || requestedSeats < 1 || requestedSeats > 8) {
      return jsonResponse({ error: 'Número de plazas no válido' }, corsHeaders, 400)
    }

    // Keep this compatibility endpoint on the same server quote as checkout.
    // It must not maintain a second OSRM/rate/commission formula: the RPC
    // derives the stored ride price, passenger distance and pickup supplement.
    const { data: quote, error: quoteError } = await supabaseClient.rpc('quote_ride_booking', {
      p_ride_id: rideId.trim(),
      p_pickup_location: pickupLocation,
      p_dropoff_location: dropoffLocation,
      p_num_seats: requestedSeats,
    })
    if (quoteError) return jsonResponse({ error: quoteError.message }, corsHeaders, 400)

    const resolvedQuote = Array.isArray(quote) ? quote[0] : quote
    if (!resolvedQuote?.success) {
      return jsonResponse(resolvedQuote || { error: 'No se pudo calcular el precio seguro' }, corsHeaders, 400)
    }

    const supplementTotal = Number(resolvedQuote.pickup_supplement_per_seat || 0) * requestedSeats
    return jsonResponse({
      ...resolvedQuote,
      // Compatibility fields for the old rideService consumer. Values are
      // canonical RPC values, not a second calculation.
      originalDistance: resolvedQuote.ride_distance_km,
      newTotalDistance: resolvedQuote.ride_distance_km,
      detourKm: Number(resolvedQuote.detour_distance_km || 0).toFixed(2),
      paxDistance: Number(resolvedQuote.passenger_distance_km || 0).toFixed(2),
      pricing: {
        basePrice: Math.max(0, Number(resolvedQuote.total || 0) - supplementTotal).toFixed(2),
        detourCost: supplementTotal.toFixed(2),
        totalPrice: Number(resolvedQuote.total || 0).toFixed(2),
        currency: 'EUR',
        commissionIncluded: true,
      },
    }, corsHeaders)
  } catch (error) {
    console.error('calculate-ride-detour:', error)
    return jsonResponse({ error: error instanceof Error ? error.message : 'Error inesperado' }, corsHeaders, 400)
  }
})
