/**
 * Servicio de Viajes (Rides) - Blindaje de Integridad v13 (Corridor Matching enabled)
 */

import { supabase } from '../lib/supabase';
import * as rpc from '@/lib/supabaseRPC';
import { addMinutes, isBefore } from 'date-fns';
import { RIDE_PRICING_CONFIG } from '../utils/pricingRules';

// REGLAS DE NEGOCIO CENTRALIZADAS
export const RIDE_RULES = {
    MIN_ADVANCE_MINUTES: 10,
    MAX_PRICE: 300,
    MIN_PRICE: 0.50,
    MAX_SEATS: 8,
    MIN_SEATS: 1
};

// Re-exportamos para compatibilidad si alguien lo importaba de aquí
export { RIDE_PRICING_CONFIG };

/**
 * Calcula el precio recomendado basado en la distancia (metros)
 */
export const calculateRecommendedPrice = (distanceInMeters) => {
    const distanceKm = distanceInMeters / 1000;
    if (distanceKm <= 0) return RIDE_RULES.MIN_PRICE;

    let remainingDistance = distanceKm;
    let totalPrice = 0;
    let previousMaxKm = 0;

    for (const tier of RIDE_PRICING_CONFIG.TIERS) {
        if (remainingDistance <= 0) break;

        const tierRange = tier.maxKm - previousMaxKm;
        const kmInThisTier = Math.min(remainingDistance, tierRange);

        totalPrice += kmInThisTier * tier.rate;
        remainingDistance -= kmInThisTier;
        previousMaxKm = tier.maxKm;
    }

    return Math.max(RIDE_RULES.MIN_PRICE, Math.min(RIDE_RULES.MAX_PRICE, parseFloat(totalPrice.toFixed(2))));
};

/**
 * Calcula el desvío y precio dinámico usando el Edge Function.
 */
export const calculateRideDetour = async (rideId, paxOrigin, paxDestination) => {
    try {
        const { data, error } = await supabase.functions.invoke('calculate-ride-detour', {
            body: { rideId, paxOrigin, paxDestination }
        });
        if (error) throw error;
        return data;
    } catch (error) {
        console.error("🛡️ [Detour Engine] calculation failed:", error);
        throw error;
    }
};

/**
 * Normaliza objetos de ubicación para evitar errores de esquema en Postgres
 */
const normalizeLocation = (loc) => ({
    address: loc?.address || '',
    name: loc?.name || loc?.address?.split(',')[0] || 'Ubicación',
    lat: parseFloat(loc?.coordinates?.lat ?? loc?.coordinates?.latitude ?? loc?.lat ?? 0),
    lng: parseFloat(loc?.coordinates?.lng ?? loc?.coordinates?.longitude ?? loc?.lng ?? 0)
});

/**
 * Validador estricto unificado para Ofertas y Solicitudes.
 */
const validateRidePayload = (data) => {
    // 1. Geometría
    const oLat = parseFloat(data.origin?.lat ?? data.origin?.coordinates?.lat ?? data.origin?.coordinates?.latitude);
    const oLng = parseFloat(data.origin?.lng ?? data.origin?.coordinates?.lng ?? data.origin?.coordinates?.longitude);
    const dLat = parseFloat(data.destination?.lat ?? data.destination?.coordinates?.lat ?? data.destination?.coordinates?.latitude);
    const dLng = parseFloat(data.destination?.lng ?? data.destination?.coordinates?.lng ?? data.destination?.coordinates?.longitude);

    if ([oLat, oLng, dLat, dLng].some((v) => Number.isNaN(v) || !Number.isFinite(v))) {
        throw new Error("Datos de itinerario incompletos: Coordenadas GPS no detectadas.");
    }

    // 2. Temporalidad (Anti-Past Trips)
    const tripDate = new Date(data.dateTime);
    if (isNaN(tripDate.getTime())) throw new Error("Fecha de viaje inválida.");
    if (isBefore(tripDate, addMinutes(new Date(), RIDE_RULES.MIN_ADVANCE_MINUTES - 1))) {
        throw new Error(`El viaje debe programarse con al menos ${RIDE_RULES.MIN_ADVANCE_MINUTES} minutos de antelación.`);
    }

    // 3. Negocio
    const price = parseFloat(data.price);
    if (isNaN(price) || price < RIDE_RULES.MIN_PRICE) throw new Error(`El precio debe ser al menos ${RIDE_RULES.MIN_PRICE}€.`);
    if (price > RIDE_RULES.MAX_PRICE) throw new Error(`El precio excede el límite de seguridad (${RIDE_RULES.MAX_PRICE}€).`);

    // Validar precio sugerido máximo
    if (data.distance && data.distance > 0) {
        const distanceMeters = data.distance * 1000;
        const recommendedMax = calculateRecommendedPrice(distanceMeters);
        if (price > recommendedMax + 0.05) {
            throw new Error(`El precio no puede superar el recomendado (${recommendedMax}€).`);
        }
    }

    const seats = parseInt(data.seats);
    if (isNaN(seats) || seats < RIDE_RULES.MIN_SEATS || seats > RIDE_RULES.MAX_SEATS) {
        throw new Error(`Número de asientos inválido (${RIDE_RULES.MIN_SEATS}-${RIDE_RULES.MAX_SEATS}).`);
    }
};

/**
 * Crea un nuevo viaje oficial (CONDUCTOR)
 */
export const createSingleRide = async (rideData) => {
    try {
        validateRidePayload(rideData);
        const ridePayload = {
            ...rideData,
            origin: normalizeLocation(rideData.origin),
            destination: normalizeLocation(rideData.destination),
            waypoints: (rideData.waypoints || []).map(normalizeLocation),
            dateTime: rideData.dateTime instanceof Date ? rideData.dateTime : new Date(rideData.dateTime)
        };

        const { data, success, error } = await rpc.createRide(ridePayload);

        if (!success) throw new Error(error);
        return data.rideId;
    } catch (error) {
        console.error("🛡️ [Offer Flow] createSingleRide failed:", error);
        throw error;
    }
};

/**
 * Crea una solicitud de viaje (PASAJERO)
 */
export const createRideRequest = async (requestData) => {
    try {
        validateRidePayload({
            ...requestData,
            seats: requestData.seats || requestData.seats_needed,
            price: requestData.price || requestData.suggested_price
        });

        const payload = {
            origin: normalizeLocation(requestData.origin),
            destination: requestData.destination ? normalizeLocation(requestData.destination) : null,
            dateTime: requestData.dateTime instanceof Date ? requestData.dateTime : new Date(requestData.dateTime),
            seats: parseInt(requestData.seats || 1),
            price: parseFloat(requestData.price || 0),
            details: (requestData.note || requestData.details || '').trim(),
            isWomenOnly: !!requestData.isWomenOnly,
            distance: parseFloat(requestData.distance || 0),
            overview_polyline: requestData.overview_polyline || ''
        };

        const { data, success, error } = await rpc.safeCall(
            () => supabase.rpc('create_ride_request', {
                p_origin: payload.origin,
                p_destination: payload.destination,
                p_departure_time: payload.dateTime.toISOString(),
                p_seats_needed: payload.seats,
                p_suggested_price: payload.price,
                p_details: payload.details,
                p_is_women_only: payload.isWomenOnly,
                p_distance: payload.distance,
                p_overview_polyline: payload.overview_polyline
            }),
            'create_ride_request'
        );

        if (!success) throw new Error(error);
        return data;
    } catch (error) {
        console.error("🛡️ [Request Flow] createRideRequest failed:", error);
        throw error;
    }
};

/**
 * Envía una reseña a la base de datos usando el nuevo RPC hardened.
 */
export const submitReview = async ({ rideId, revieweeId, rating, comment }) => {
    try {
        const { success, error } = await rpc.safeCall(
            () => supabase.rpc('submit_reviews', {
                p_ride_id: rideId,
                p_reviews: [{
                    target_id: revieweeId,
                    rating: parseInt(rating),
                    comment: comment
                }]
            }),
            'submit_reviews'
        );

        if (!success) throw new Error(error);
        return true;
    } catch (error) {
        console.error("🛡️ [Review Flow] submitReview failed:", error);
        throw error;
    }
};

/**
 * Obtiene viajes disponibles (Legacy radio-based)
 */
export const getAvailableRides = async () => {
    try {
        const { data, success, error } = await rpc.safeCall(
            () => supabase.rpc('get_available_rides_v2'),
            'get_available_rides_v2'
        );
        if (!success) throw new Error(error);
        return data || [];
    } catch (error) {
        console.error("🛡️ stability: getAvailableRides failed:", error);
        return [];
    }
};

/**
 * Busca viajes usando el MOTOR DE CORREDOR (Inteligente)
 */
export const searchRides = async ({ origin, destination, date, maxDetour = 2500 }) => {
    try {
        const oCoords = origin.coordinates || origin;
        const dCoords = destination.coordinates || destination;

        const { data, success, error } = await rpc.safeCall(
            () => supabase.rpc('search_rides_by_corridor', {
                p_pax_origin_lat: parseFloat(oCoords.lat),
                p_pax_origin_lng: parseFloat(oCoords.lng),
                p_pax_dest_lat: parseFloat(dCoords.lat),
                p_pax_dest_lng: parseFloat(dCoords.lng),
                p_date: date || null,
                p_max_detour_meters: maxDetour
            }),
            'search_rides_by_corridor'
        );

        if (!success) throw new Error(error);

        return (data || []).map(ride => ({
            ...ride,
            type: 'ride',
            driver: {
                id: ride.driver_id,
                display_name: ride.driver_name,
                photo_url: ride.driver_photo,
                rating: ride.driver_rating,
                verification: { status: ride.driver_verified ? 'verified' : 'not_verified' }
            }
        }));
    } catch (error) {
        console.error("🛡️ [Search Flow] searchRides by corridor failed:", error);
        throw error;
    }
};

export const fulfillRequest = async (request, customPrice) => {
    const rideData = {
        requestId: request.id,
        origin: request.origin,
        destination: request.destination,
        dateTime: new Date(request.departure_time),
        seats: request.seats_needed || 1,
        price: customPrice || request.suggested_price,
        details: `Aceptado desde solicitud de pasajero`,
        distance: request.distance || 0,
        overview_polyline: request.overview_polyline || '',
        waypoints: []
    };

    validateRidePayload(rideData);

    const { data, success, error } = await rpc.fulfillRideRequest(rideData);
    if (!success) {
        if (error?.includes('no está disponible')) {
            throw new Error('Esta solicitud ya fue aceptada por otro conductor.');
        }
        throw new Error(error || 'No se pudo aceptar la solicitud.');
    }
    return data.rideId;
};

export const startRide = async (rideId) => {
    const { success, error } = await rpc.startRide(rideId);
    if (!success) throw new Error(error);
    return true;
};

export const completeRide = async (rideId) => {
    const { success, error } = await rpc.completeRide(rideId);
    if (!success) throw new Error(error);
    return true;
};

export const cancelRide = async (rideId) => {
    const { success, error } = await rpc.cancelRide(rideId);
    if (!success) throw new Error(error);
    return true;
};

export const cancelBooking = async (rideId) => {
    try {
        const { data, error } = await supabase.functions.invoke('cancel-booking-and-refund', {
            body: { rideId }
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        return true;
    } catch (error) {
        console.error("🛡️ [Booking Flow] cancelBooking failed:", error);
        throw error;
    }
};

export const verifyPassenger = async (rideId, passengerId, pin) => {
    // Nota: passengerId ya no es estrictamente necesario en el RPC unificado,
    // pero lo mantenemos en la firma del servicio para no romper la UI.
    const { success, error } = await rpc.verifyPassenger(rideId, pin);
    if (!success) throw new Error(error);
    return true;
};

export const acceptPassenger = async (rideId, passengerId) => {
    const { data, error } = await supabase.rpc('accept_passenger', { p_ride_id: rideId, p_passenger_id: passengerId });
    if (error) throw new Error(error.message);
    return data;
};

export const rejectPassenger = async (rideId, passengerId) => {
    const { data, error } = await supabase.rpc('reject_passenger', { p_ride_id: rideId, p_passenger_id: passengerId });
    if (error) throw error;
    return data;
};

export const removePassenger = async (rideId, passengerId) => {
    const { success, error } = await rpc.removePassenger(rideId, passengerId);
    if (!success) throw new Error(error);
    return true;
};

export const markNoShow = async (rideId, passengerId) => {
    const { success, error } = await rpc.handlePassengerNoShow(rideId, passengerId);
    if (!success) throw new Error(error);
    return true;
};

export const updateRide = async (rideId, rideData) => {
    const { data, error } = await supabase.rpc('update_ride_v2', {
        p_ride_id: rideId,
        p_departure_time: rideData.dateTime.toISOString(),
        p_seats: parseInt(rideData.seats),
        p_price: parseFloat(rideData.price),
        p_details: rideData.details || '',
        p_is_women_only: rideData.isWomenOnly || false
    });
    if (error) throw new Error(error.message);
    return data;
};

export const getUserRides = async () => {
    const { data, success, error } = await rpc.getUserRides();
    if (!success) throw new Error(error);
    return data;
};

export const searchRequests = async ({ origin, destination, date, seats = 1, radius = 15000 }) => {
    const { data, success, error } = await rpc.searchRideRequests(origin, destination, date, seats, radius);
    if (!success) throw new Error(error);

    return (data || []).map(req => ({
        ...req,
        type: 'request',
        requester: {
            id: req.requester_id,
            display_name: req.requester_display_name,
            photo_url: req.requester_photo_url,
            rating: req.requester_rating
        }
    }));
};

export const saveFavoriteRoute = async (routeData) => {
    const payload = {
        user_id: routeData.user_id,
        name: routeData.name,
        origin: normalizeLocation(routeData.origin),
        destination: normalizeLocation(routeData.destination),
        days: routeData.days || []
    };

    if (routeData.id) {
        payload.id = routeData.id;
    }

    const { data, success, error } = await rpc.safeCall(
        () => supabase.from('favorite_routes').upsert(payload).select().single(),
        'upsert_favorite_route'
    );

    if (!success) throw new Error(error);
    return data;
};
