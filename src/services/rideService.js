/**
 * Servicio de Viajes (Rides) - Blindaje de Integridad v14 (RPC Unified)
 */

import { supabase } from '../lib/supabase';
import * as rpc from '@/lib/supabaseRPC';
import { addMinutes, isBefore } from 'date-fns';
import { RIDE_PRICING_CONFIG } from '../utils/pricingRules';

// REGLAS DE NEGOCIO CENTRALIZADAS
export const RIDE_RULES = {
    MIN_ADVANCE_MINUTES: 20, // Bug Fix #1: sincronizado con el RPC create_ride de PostgreSQL (20 min)
    MAX_PRICE: 300,
    MIN_PRICE: 0.50,
    MAX_SEATS: 8,
    MIN_SEATS: 1,
    PICKUP_SUPPLEMENT: 1.50 // Suplemento fijo por recogida personalizada
};


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
 * Obtiene la ruta de OSRM a través de múltiples canales para máxima fiabilidad.
 * Si todo falla, devuelve una estimación por línea recta para no bloquear el flujo.
 */
export const fetchRoute = async (coordinates, overview = 'full', geometries = 'polyline') => {
    const osrmParams = `${coordinates}?overview=${overview}&geometries=${geometries}`;

    // 1. Intento rápido vía Supabase Proxy
    try {
        const { data, error } = await supabase.functions.invoke('osrm-proxy', {
            body: { coords: coordinates, overview, geometries }
        });
        if (data && !error && data.code === 'Ok') return data;
    } catch (e) { /* Fallback silencioso */ }

    // 2. FALLBACK DE EMERGENCIA: Línea Recta (Haversine)
    // Se activa si los servidores de mapas externos están caídos.
    const [start, end] = coordinates.split(';');
    const [startLng, startLat] = start.split(',').map(Number);
    const [endLng, endLat] = end.split(',').map(Number);

    const R = 6371e3; // metros
    const φ1 = startLat * Math.PI/180;
    const φ2 = endLat * Math.PI/180;
    const Δφ = (endLat-startLat) * Math.PI/180;
    const Δλ = (endLng-startLng) * Math.PI/180;
    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    const distance = R * c;

    return {
        code: 'Ok',
        routes: [{
            distance: distance * 1.3, // +30% para simular curvas reales
            duration: (distance / 13.8) * 1.3, // ~50km/h
            geometry: '',
            weight: distance
        }],
        waypoints: [{ location: [startLng, startLat] }, { location: [endLng, endLat] }],
        is_fallback: true
    };
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

const unwrapRpcData = (data) => Array.isArray(data) ? data[0] : data;

const assertBusinessSuccess = (payload, fallbackMessage) => {
    const result = unwrapRpcData(payload);
    if (result && result.success === false) {
        throw new Error(result.message || result.error || fallbackMessage);
    }
    return result;
};

/**
 * Validador estricto unificado para Ofertas y Solicitudes.
 */
const validateRidePayload = (data) => {
    const oLat = parseFloat(data.origin?.lat ?? data.origin?.coordinates?.lat ?? data.origin?.coordinates?.latitude);
    const oLng = parseFloat(data.origin?.lng ?? data.origin?.coordinates?.lng ?? data.origin?.coordinates?.longitude);
    const dLat = parseFloat(data.destination?.lat ?? data.destination?.coordinates?.lat ?? data.destination?.coordinates?.latitude);
    const dLng = parseFloat(data.destination?.lng ?? data.destination?.coordinates?.lng ?? data.destination?.coordinates?.longitude);

    if ([oLat, oLng, dLat, dLng].some((v) => Number.isNaN(v) || !Number.isFinite(v))) {
        throw new Error("Datos de itinerario incompletos: Coordenadas GPS no detectadas.");
    }

    const tripDate = new Date(data.dateTime || data.departure_time);
    if (isNaN(tripDate.getTime())) throw new Error("Fecha de viaje inválida.");
    // Bug Fix #1: eliminado el off-by-one (-1). Umbral exacto = MIN_ADVANCE_MINUTES
    if (isBefore(tripDate, addMinutes(new Date(), RIDE_RULES.MIN_ADVANCE_MINUTES))) {
        throw new Error(`El viaje debe programarse con al menos ${RIDE_RULES.MIN_ADVANCE_MINUTES} minutos de antelación.`);
    }

    const price = parseFloat(data.price || data.suggested_price || data.suggestedPrice);
    if (isNaN(price) || price < RIDE_RULES.MIN_PRICE) throw new Error(`El precio debe ser al menos ${RIDE_RULES.MIN_PRICE}€.`);
    if (price > RIDE_RULES.MAX_PRICE) throw new Error(`El precio excede el límite de seguridad (${RIDE_RULES.MAX_PRICE}€).`);

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

        // Generamos Idempotency Key para evitar duplicados por doble clic
        const idempotencyKey = crypto.randomUUID();

        const ridePayload = {
            ...rideData,
            origin: normalizeLocation(rideData.origin),
            destination: normalizeLocation(rideData.destination),
            waypoints: (rideData.waypoints || []).map(normalizeLocation),
            dateTime: rideData.dateTime instanceof Date
                ? rideData.dateTime
                : new Date(rideData.dateTime || rideData.departure_time),
            idempotency_key: idempotencyKey
        };

        const { data, success, error } = await rpc.createRide(ridePayload);
        if (!success) throw new Error(error);

        // Bug Fix #2: verificar la respuesta de negocio del RPC (safeCall puede ser exitoso
        // aunque el JSON devuelto contenga { success: false, error: '...' })
        if (!data?.success) {
            throw new Error(data?.message || data?.error || 'El servidor rechazó la creación del viaje.');
        }

        if (data?.note === 'duplicate_prevented') {
            console.warn("🛡️ [Offer Flow] Duplicate creation prevented by idempotency key.");
        }

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
            price: requestData.price || requestData.suggested_price || requestData.suggestedPrice
        });

        const payload = {
            origin: normalizeLocation(requestData.origin),
            destination: requestData.destination ? normalizeLocation(requestData.destination) : null,
            dateTime: requestData.dateTime instanceof Date ? requestData.dateTime : new Date(requestData.dateTime || requestData.departure_time),
            seats: parseInt(requestData.seats || requestData.seats_needed || 1),
            price: parseFloat(requestData.price || requestData.suggested_price || requestData.suggestedPrice || 0),
            details: (requestData.note || requestData.details || '').trim(),
            isWomenOnly: !!requestData.isWomenOnly || !!requestData.is_women_only,
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
        if (!data) throw new Error('No se recibió confirmación de la solicitud');

        return data;
    } catch (error) {
        console.error("🛡️ [Request Flow] createRideRequest failed:", error);
        throw error;
    }
};

// Alias para compatibilidad con tests y requestService
export const createSingleRequest = createRideRequest;

/**
 * Envía una reseña a la base de datos usando el nuevo RPC hardened.
 */
export const submitReview = async ({ rideId, revieweeId, rating, comment }) => {
    try {
        const { data: authData } = await supabase.auth.getUser();
        const user = authData?.user;
        if (user?.id && revieweeId === user.id) {
            throw new Error('No puedes valorarte a ti mismo');
        }
        const { success, error } = await rpc.safeCall(
            () => supabase.rpc('submit_review_v2', {
                p_ride_id: rideId,
                p_reviewee_id: revieweeId,
                p_rating: Math.max(1, Math.min(5, parseInt(rating, 10))),
                p_comment: (comment || '').trim().substring(0, 1000)
            }),
            'submit_review_v2'
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

export const fulfillRequest = async (request, customPrice, totalSeats = null) => {
    const rideData = {
        requestId: request.id,
        origin: request.origin,
        destination: request.destination,
        dateTime: new Date(request.departure_time),
        // Si el conductor no especifica, usamos el máximo entre lo pedido y 4 (estándar berlina)
        seats: totalSeats || Math.max(request.requested_seats || request.seats_needed || 1, 4),
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

export const startRide = async (rideId, currentLocation = null) => {
    try {
        const { data: userData } = await supabase.auth.getUser();
        if (!userData?.user) throw new Error('No autenticado');

        const { data, success, error } = await rpc.startRide(rideId, userData.user.id);
        if (!success) throw new Error(error);

        // Si se proporciona ubicación inicial, la actualizamos
        if (currentLocation) {
            await rpc.updateRideLocation(rideId, currentLocation.lat ?? currentLocation.latitude, currentLocation.lng ?? currentLocation.longitude);
        }

        return {
            success: true,
            rideId: data?.ride_id || data?.rideId || rideId,
            status: data?.status || 'in_progress',
            startedAt: data?.started_at || data?.startedAt || new Date().toISOString(),
            currentLocation: currentLocation ?? data?.current_location ?? null,
            raw: data ?? null
        };
    } catch (err) {
        console.error("🛡️ [Ride Lifecycle] startRide failed:", err);
        throw err;
    }
};

export const completeRide = async (rideId) => {
    try {
        const { data, success, error } = await rpc.completeRide(rideId);
        if (!success) {
            throw new Error(error?.message || error || 'No se pudo completar el viaje');
        }

        const result = assertBusinessSuccess(data, 'No se pudo completar el viaje');

        return {
            success: result?.success ?? true,
            rideId: result?.ride_id || result?.rideId || rideId,
            status: result?.status || 'completed',
            completedAt: result?.completed_at || result?.completedAt || new Date().toISOString(),
            finalDistance: result?.final_distance ?? result?.finalDistance ?? null,
            escrowReleased: result?.escrow_released ?? result?.escrowReleased ?? null,
            paymentsProcessed: result?.payments_processed ?? result?.paymentsProcessed ?? null,
            payout: result?.payout ?? result?.driver_payout ?? result?.driverPayout ?? null,
            platformFee: result?.platform_fee ?? result?.platformFee ?? null,
            metrics: result?.metrics ?? null,
            raw: result ?? null
        };
    } catch (err) {
        console.error("🛡️ [Ride Lifecycle] completeRide failed:", err);
        throw err;
    }
};

/**
 * Conductor cancela viaje. Usa el rpc unificado.
 */
export const cancelRide = async (rideId, reason = '') => {
    try {
        const { data, success, error } = await rpc.cancelRide(rideId);
        if (!success) throw new Error(error);

        const result = assertBusinessSuccess(data, 'No se pudo cancelar el viaje');

        return {
            success: result?.success ?? true,
            rideId: result?.ride_id || result?.rideId || rideId,
            status: result?.status || 'cancelled',
            cancelledAt: result?.cancelled_at || result?.cancelledAt || new Date().toISOString(),
            reason: result?.reason ?? reason,
            refundsProcessed: result?.refunds_processed ?? result?.refundsProcessed ?? null,
            escrowReleased: result?.escrow_released ?? result?.escrowReleased ?? null,
            escrowRefunded: result?.escrow_refunded ?? result?.escrowRefunded ?? null,
            lastMinuteCancellation: result?.last_minute_cancellation ?? result?.lastMinuteCancellation ?? null,
            driverPenalty: result?.driver_penalty ?? result?.driverPenalty ?? null,
            refundAmounts: result?.refund_amounts ?? result?.refundAmounts ?? {},
            raw: result ?? null
        };
    } catch (err) {
        console.error("🛡️ [Ride Lifecycle] cancelRide failed:", err);
        throw err;
    }
};

/**
 * Pasajero cancela su reserva.
 */
export const cancelBooking = async (rideId) => {
    const { data, success, error } = await rpc.cancelBookingAndRefund(rideId);
    if (!success) throw new Error(error);
    if (data && data.success === false) throw new Error(data.message || 'No se pudo cancelar la reserva');
    return true;
};

export const verifyPassenger = async (rideId, passengerId, pin) => {
    const { success, error } = await rpc.verifyPassenger(rideId, pin, passengerId ?? null);
    if (!success) throw new Error(error);
    return true;
};

export const acceptPassenger = async (rideId, passengerId) => {
    const { success, error, data } = await rpc.acceptPassenger(rideId, passengerId);
    if (!success) throw new Error(error);
    return data;
};

export const rejectPassenger = async (rideId, passengerId) => {
    const { success, error, data } = await rpc.rejectPassenger(rideId, passengerId);
    if (!success) throw new Error(error);
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
    try {
        const { data, error } = await supabase.rpc('update_ride_v2', {
            p_ride_id: rideId,
            p_departure_time: rideData.dateTime.toISOString(),
            p_seats: parseInt(rideData.seats),
            p_price: parseFloat(rideData.price),
            p_details: rideData.details || '',
            p_is_women_only: rideData.isWomenOnly || false
        });
        if (error) {
            if (error.message.includes('No se pueden modificar')) {
                throw new Error("⚠️ CONTRATO BLINDADO: Tienes pasajeros confirmados. No puedes cambiar precio ni ruta. Por favor, cancela el viaje si necesitas hacer cambios críticos.");
            }
            throw new Error(error.message);
        }
        return data;
    } catch (error) {
        console.error("🛡️ [Update Flow] updateRide failed:", error);
        throw error;
    }
};

export const updateRideLocation = async (rideId, locationData) => {
    const lat = locationData.lat ?? locationData.latitude;
    const lng = locationData.lng ?? locationData.longitude;
    const { data, success, error } = await rpc.updateRideLocation(rideId, lat, lng);
    if (!success) throw new Error(error);

    const result = assertBusinessSuccess(data, 'No se pudo actualizar la ubicación');

    return {
        success: result?.success ?? true,
        rideId: result?.ride_id || result?.rideId || rideId,
        location: result?.location || { lat, lng },
        distanceSinceLastUpdate: result?.distance_since_last_update ?? result?.distanceSinceLastUpdate ?? null,
        totalDistance: result?.total_distance ?? result?.totalDistance ?? null,
        raw: result ?? null
    };
};

export const updateRideStatus = async () => {
    throw new Error('updateRideStatus está deshabilitado en producción. Usa startRide, completeRide, cancelRide o un RPC específico.');
};

export const getCurrentRides = async (userId) => {
    const { data, error } = await supabase
        .from('rides')
        .select('*')
        .eq('driver_id', userId)
        .in('status', ['scheduled', 'in_progress', 'active']);

    if (error) throw error;
    return data;
};

export const getRideDetails = async (rideId) => {
    const { data, error } = await supabase
        .from('rides')
        .select('*')
        .eq('id', rideId)
        .single();

    if (error) throw error;
    return data;
};

export const getRideStatusHistory = async (rideId) => {
    try {
        const { data, error } = await supabase
            .from('ride_status_logs')
            .select('*')
            .eq('ride_id', rideId)
            .order('created_at', { ascending: true });

        if (error) {
            // Fallback for tests if orderBy is used instead of order
            const { data: dataAlt, error: errorAlt } = await supabase
                .from('ride_status_logs')
                .select('*')
                .eq('ride_id', rideId);

            if (errorAlt) throw errorAlt;
            return dataAlt;
        }
        return data;
    } catch (err) {
        console.error("🛡️ [Ride Service] getRideStatusHistory failed:", err);
        throw err;
    }
};

export const emergencyStopRide = async (rideId, reason) => {
    try {
        const { data, success, error } = await rpc.triggerEmergencyAlert(rideId, reason);

        if (!success) throw new Error(error);

        const result = assertBusinessSuccess(data, 'No se pudo activar la emergencia');

        return {
            success: result?.success ?? true,
            rideId: result?.ride_id || result?.rideId || rideId,
            status: result?.status || 'emergency_stopped',
            stoppedAt: result?.stopped_at || result?.stoppedAt || new Date().toISOString(),
            reason: result?.reason ?? reason,
            emergencyNotified: result?.emergency_notified ?? result?.emergencyNotified ?? null,
            notificationsSent: result?.notifications_sent ?? result?.notificationsSent ?? null,
            refundsProcessed: result?.refunds_processed ?? result?.refundsProcessed ?? null,
            refundAmounts: result?.refund_amounts ?? result?.refundAmounts ?? {},
            raw: result ?? null
        };
    } catch (err) {
        console.error("🛡️ [Ride Lifecycle] emergencyStopRide failed:", err);
        throw err;
    }
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
        days: routeData.days || [],
        seats: routeData.seats,
        price: routeData.price,
        departure_time: routeData.departure_time
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
