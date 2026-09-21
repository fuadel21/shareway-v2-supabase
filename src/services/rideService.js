/**
 * Servicio de Viajes (Rides) - Blindaje de Integridad v14 (RPC Unified)
 */

import { supabase } from '../lib/supabase';
import * as rpc from '@/lib/supabaseRPC';
import { addMinutes, isBefore } from 'date-fns';
import { calculateDistance } from '../lib/utils.js';
import {
    calculateSuggestedPrice,
    FINANCIAL_RULES,
    PRICING_CONSTANTS,
    RIDE_PRICING_CONFIG
} from '../utils/pricingRules';

// REGLAS DE NEGOCIO CENTRALIZADAS
export const RIDE_RULES = {
    MIN_ADVANCE_MINUTES: 20,
    MAX_PRICE: PRICING_CONSTANTS.MAX_PRICE,
    MIN_PRICE: PRICING_CONSTANTS.MIN_PRICE,
    MAX_SEATS: PRICING_CONSTANTS.MAX_SEATS,
    MIN_SEATS: PRICING_CONSTANTS.MIN_SEATS,
    PICKUP_SUPPLEMENT: FINANCIAL_RULES.PICKUP_SUPPLEMENT
};

const BOOKABLE_RIDE_STATUSES = new Set(['scheduled']);

export const isRideBookable = (ride, now = new Date()) => {
    if (!ride || !BOOKABLE_RIDE_STATUSES.has(ride.status)) return false;
    const departure = new Date(ride.departure_time || ride.departureTime);
    if (Number.isNaN(departure.getTime())) return false;
    if (departure <= now) return false;
    if (Number(ride.seats_available ?? ride.available_seats ?? 1) <= 0) return false;
    return true;
};

export const filterBookableRides = (rides = []) => {
    const now = new Date();
    return (rides || []).filter((ride) => isRideBookable(ride, now));
};

export { RIDE_PRICING_CONFIG };

/**
 * Calcula el precio recomendado basado en la distancia (metros).
 * The utility function and the SQL migration use kilometres; this adapter is
 * kept for the existing form API.
 */
export const calculateRecommendedPrice = (distanceInMeters) => {
    const distanceKm = Number(distanceInMeters) / 1000;
    return Number(calculateSuggestedPrice(distanceKm));
};

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

export const fetchRoute = async (coordinates, overview = 'full', geometries = 'polyline') => {
    try {
        const { data, error } = await supabase.functions.invoke('osrm-proxy', {
            body: { coords: coordinates, overview, geometries }
        });
        if (data && !error && data.code === 'Ok') return data;
    } catch (e) { }

    const [start, end] = coordinates.split(';');
    const [startLng, startLat] = start.split(',').map(Number);
    const [endLng, endLat] = end.split(',').map(Number);

    const R = 6371e3;
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
            distance: distance * 1.3,
            duration: (distance / 13.8) * 1.3,
            geometry: '',
            weight: distance
        }],
        waypoints: [{ location: [startLng, startLat] }, { location: [endLng, endLat] }],
        is_fallback: true
    };
};

const normalizeLocation = (loc) => ({
    address: loc?.address || '',
    name: loc?.name || loc?.address?.split(',')[0] || 'Ubicación',
    lat: parseFloat(loc?.coordinates?.lat ?? loc?.coordinates?.latitude ?? loc?.lat ?? 0),
    lng: parseFloat(loc?.coordinates?.lng ?? loc?.coordinates?.longitude ?? loc?.lng ?? 0)
});

const getLocationCoordinates = (location) => {
    const coordinates = location?.coordinates || location || {};
    const lat = Number(coordinates.lat ?? coordinates.latitude);
    const lng = Number(coordinates.lng ?? coordinates.longitude);
    const validRange = lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
    return Number.isFinite(lat) && Number.isFinite(lng) && validRange ? { lat, lng } : null;
};

const resolveDistanceKm = (distance, origin, destination) => {
    const explicitDistance = Number(distance);
    if (Number.isFinite(explicitDistance) && explicitDistance > 0) return explicitDistance;

    const originCoordinates = getLocationCoordinates(origin);
    const destinationCoordinates = getLocationCoordinates(destination);
    if (!originCoordinates || !destinationCoordinates) return 0;

    return calculateDistance(
        originCoordinates.lat,
        originCoordinates.lng,
        destinationCoordinates.lat,
        destinationCoordinates.lng,
    );
};

const clampSeats = (value) => Math.max(RIDE_RULES.MIN_SEATS, Math.min(RIDE_RULES.MAX_SEATS, Number(value || 1)));

const cleanPlate = (value) => String(value || '')
    .replace(/\s+/g, '')
    .replace(/[^a-zA-Z0-9*]/g, '')
    .toUpperCase()
    .slice(0, 8);

const normalizeVehicleSnapshot = (vehicle = null) => {
    if (!vehicle || typeof vehicle !== 'object') return null;

    const make = String(vehicle.make || '').trim();
    const model = String(vehicle.model || '').trim();
    if (!make && !model) return null;

    return {
        make,
        model,
        year: String(vehicle.year || '').trim(),
        color: String(vehicle.color || '').trim(),
        plate: cleanPlate(vehicle.plate || vehicle.plate_partial || ''),
        seats: clampSeats(vehicle.seats || vehicle.total_seats || 1),
        luggage: vehicle.luggage || 'medium',
        pets: Boolean(vehicle.pets),
        kids: vehicle.kids !== false,
        ac: vehicle.ac !== false,
        smoking: Boolean(vehicle.smoking),
        notes: String(vehicle.notes || '').trim().slice(0, 280),
        photoURL: vehicle.photoURL || vehicle.photo_url || '',
        capturedAt: new Date().toISOString()
    };
};

const attachVehicleSnapshotToRide = async (rideId, vehicle) => {
    const snapshot = normalizeVehicleSnapshot(vehicle);
    if (!rideId || !snapshot) return;

    try {
        const vehicleModel = [snapshot.make, snapshot.model].filter(Boolean).join(' ').trim();
        const { error } = await supabase
            .from('rides')
            .update({
                vehicle_model: vehicleModel || null,
                vehicle_plate: snapshot.plate || null,
                vehicle_color: snapshot.color || null,
                vehicle_year: snapshot.year || null,
                vehicle_photo_url: snapshot.photoURL || null,
                vehicle_luggage: snapshot.luggage || null,
                vehicle_snapshot: snapshot
            })
            .eq('id', rideId);

        if (error) console.warn('🚗 [Vehicle Snapshot] Could not attach vehicle to ride:', error.message);
    } catch (error) {
        console.warn('🚗 [Vehicle Snapshot] Unexpected error:', error.message);
    }
};

const unwrapRpcData = (data) => Array.isArray(data) ? data[0] : data;

const assertBusinessSuccess = (payload, fallbackMessage) => {
    const result = unwrapRpcData(payload);
    if (result && result.success === false) {
        throw new Error(result.message || result.error || fallbackMessage);
    }
    return result;
};

const validateRidePayload = (data) => {
    const oLat = parseFloat(data.origin?.lat ?? data.origin?.coordinates?.lat ?? data.origin?.coordinates?.latitude);
    const oLng = parseFloat(data.origin?.lng ?? data.origin?.coordinates?.lng ?? data.origin?.coordinates?.longitude);
    const dLat = parseFloat(data.destination?.lat ?? data.destination?.coordinates?.lat ?? data.destination?.coordinates?.latitude);
    const dLng = parseFloat(data.destination?.lng ?? data.destination?.coordinates?.lng ?? data.destination?.coordinates?.longitude);

    if ([oLat, oLng, dLat, dLng].some((v) => Number.isNaN(v) || !Number.isFinite(v))) {
        throw new Error("Datos de itinerario incompletos: Coordenadas GPS no detectadas.");
    }
    if ([oLat, dLat].some((value) => value < -90 || value > 90)
        || [oLng, dLng].some((value) => value < -180 || value > 180)) {
        throw new Error('Coordenadas GPS fuera de rango.');
    }

    const tripDate = new Date(data.dateTime || data.departure_time);
    if (isNaN(tripDate.getTime())) throw new Error("Fecha de viaje inválida.");
    if (isBefore(tripDate, addMinutes(new Date(), RIDE_RULES.MIN_ADVANCE_MINUTES))) {
        throw new Error(`El viaje debe programarse con al menos ${RIDE_RULES.MIN_ADVANCE_MINUTES} minutos de antelación.`);
    }

    const price = parseFloat(data.price || data.suggested_price || data.suggestedPrice);
    if (isNaN(price) || price < RIDE_RULES.MIN_PRICE) throw new Error(`El precio debe ser al menos ${RIDE_RULES.MIN_PRICE}€.`);
    if (price > RIDE_RULES.MAX_PRICE) throw new Error(`El precio excede el límite de seguridad (${RIDE_RULES.MAX_PRICE}€).`);

    const distanceKm = Number(data.distance);
    if (!Number.isFinite(distanceKm) || distanceKm <= 0) {
        throw new Error('La distancia de la ruta es obligatoria para validar el precio.');
    }

    const recommendedMax = calculateRecommendedPrice(distanceKm * 1000);
    if (price > recommendedMax + 0.05) {
        throw new Error(`El precio no puede superar el recomendado (${recommendedMax}€).`);
    }

    const seats = parseInt(data.seats);
    if (isNaN(seats) || seats < RIDE_RULES.MIN_SEATS || seats > RIDE_RULES.MAX_SEATS) {
        throw new Error(`Número de asientos inválido (${RIDE_RULES.MIN_SEATS}-${RIDE_RULES.MAX_SEATS}).`);
    }
};

export const createSingleRide = async (rideData) => {
    try {
        const distanceKm = resolveDistanceKm(rideData.distance, rideData.origin, rideData.destination);
        validateRidePayload({ ...rideData, distance: distanceKm });
        const idempotencyKey = crypto.randomUUID();
        const vehicleSnapshot = normalizeVehicleSnapshot(
            rideData.vehicle || rideData.vehicle_snapshot || rideData.preferences?.vehicle_snapshot
        );

        const ridePayload = {
            ...rideData,
            preferences: {
                ...(rideData.preferences || {}),
                vehicle_snapshot: vehicleSnapshot
            },
            origin: normalizeLocation(rideData.origin),
            destination: normalizeLocation(rideData.destination),
            distance: distanceKm,
            waypoints: (rideData.waypoints || []).map(normalizeLocation),
            dateTime: rideData.dateTime instanceof Date ? rideData.dateTime : new Date(rideData.dateTime || rideData.departure_time),
            idempotency_key: idempotencyKey
        };

        const { data, success, error } = await rpc.createRide(ridePayload);
        if (!success) throw new Error(error);
        if (!data?.success) throw new Error(data?.message || data?.error || 'El servidor rechazó la creación del viaje.');

        const rideId = data.rideId || data.ride_id || data.id;
        await attachVehicleSnapshotToRide(rideId, vehicleSnapshot);
        return rideId;
    } catch (error) {
        console.error("🛡️ [Offer Flow] createSingleRide failed:", error);
        throw error;
    }
};

export const createRideRequest = async (requestData) => {
    try {
        const distanceKm = resolveDistanceKm(requestData.distance, requestData.origin, requestData.destination);
        validateRidePayload({
            ...requestData,
            seats: requestData.seats || requestData.seats_needed,
            price: requestData.price || requestData.suggested_price || requestData.suggestedPrice,
            distance: distanceKm,
        });

        const payload = {
            origin: normalizeLocation(requestData.origin),
            destination: requestData.destination ? normalizeLocation(requestData.destination) : null,
            dateTime: requestData.dateTime instanceof Date ? requestData.dateTime : new Date(requestData.dateTime || requestData.departure_time),
            seats: parseInt(requestData.seats || requestData.seats_needed || 1),
            price: parseFloat(requestData.price || requestData.suggested_price || requestData.suggestedPrice || 0),
            details: (requestData.note || requestData.details || '').trim(),
            isWomenOnly: !!requestData.isWomenOnly || !!requestData.is_women_only,
            distance: distanceKm,
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

export const createSingleRequest = createRideRequest;

export const submitReview = async ({ rideId, revieweeId, rating, comment }) => {
    try {
        const { data: authData } = await supabase.auth.getUser();
        const user = authData?.user;
        if (user?.id && revieweeId === user.id) throw new Error('No puedes valorarte a ti mismo');
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

export const getAvailableRides = async () => {
    try {
        const { data, success, error } = await rpc.safeCall(
            () => supabase.rpc('get_available_rides_v2'),
            'get_available_rides_v2'
        );
        if (!success) throw new Error(error);
        return filterBookableRides(data || []);
    } catch (error) {
        console.error("🛡️ stability: getAvailableRides failed:", error);
        return [];
    }
};

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

        return filterBookableRides(data || []).map(ride => ({
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

export const fulfillRequest = async (request, customPrice = null, totalSeats = null) => {
    if (!request?.id) throw new Error('Solicitud de viaje no encontrada.');

    const requestedSeats = Number(request.requested_seats ?? request.seats_needed ?? request.seats ?? 1);
    const capacity = totalSeats === null || totalSeats === undefined
        ? Math.max(requestedSeats, 4)
        : Number(totalSeats);
    const distanceKm = resolveDistanceKm(request.distance, request.origin, request.destination);
    const pricePerSeat = customPrice === null || customPrice === undefined
        ? Number(request.suggested_price ?? request.price)
        : Number(customPrice);

    const rideData = {
        requestId: request.id,
        // The RPC uses the locked request row as its source of truth. These
        // fields are retained for the stable public signature only.
        origin: request.origin,
        destination: request.destination,
        dateTime: new Date(request.departure_time),
        seats: capacity,
        price: pricePerSeat,
        details: 'Aceptado desde solicitud de pasajero',
        distance: distanceKm,
        overview_polyline: request.overview_polyline || '',
        waypoints: []
    };

    validateRidePayload(rideData);
    const { data, success, error } = await rpc.fulfillRideRequest(rideData);
    if (!success) {
        if (error?.includes('REQUEST_NOT_AVAILABLE') || error?.includes('no está disponible')) {
            throw new Error('Esta solicitud ya fue aceptada por otro conductor.');
        }
        throw new Error(error || 'No se pudo aceptar la solicitud.');
    }
    if (!data?.success) throw new Error(data?.error || 'No se pudo aceptar la solicitud.');
    return data.rideId || data.ride_id;
};

export const startRide = async (rideId, currentLocation = null) => {
    try {
        const { data: userData } = await supabase.auth.getUser();
        if (!userData?.user) throw new Error('No autenticado');
        const { data, success, error } = await rpc.startRide(rideId, userData.user.id);
        if (!success) throw new Error(error);
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
        if (!success) throw new Error(error?.message || error || 'No se pudo completar el viaje');
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
            platformFee: result?.platform_fee ?? result?.platform_fee_total ?? result?.platformFee ?? result?.fee ?? null,
            metrics: result?.metrics ?? null,
            raw: result ?? null
        };
    } catch (err) {
        console.error("🛡️ [Ride Lifecycle] completeRide failed:", err);
        throw err;
    }
};

export const cancelRide = async (rideId, reason = '') => {
    try {
        const { data, success, error } = await rpc.cancelRide(rideId, reason);
        if (!success) throw new Error(error);
        const response = assertBusinessSuccess(data, 'No se pudo cancelar el viaje');
        const result = response?.details || response;
        assertBusinessSuccess(result, 'No se pudo cancelar el viaje');
        return {
            success: result?.success ?? true,
            rideId: result?.ride_id || result?.rideId || rideId,
            status: result?.status || 'cancelled',
            cancelledAt: result?.cancelled_at || result?.cancelledAt || new Date().toISOString(),
            reason: result?.reason ?? reason,
            refundsProcessed: result?.refunds_processed ?? result?.refundsProcessed ?? (result?.passenger_compensation_total != null),
            escrowReleased: result?.escrow_released ?? result?.escrowReleased ?? null,
            escrowRefunded: result?.escrow_refunded ?? result?.escrowRefunded ?? null,
            lastMinuteCancellation: result?.last_minute_cancellation ?? result?.lastMinuteCancellation ?? null,
            driverPenalty: result?.driver_penalty ?? result?.driverPenalty ?? result?.penalty ?? null,
            passengerCompensationTotal: result?.passenger_compensation_total ?? result?.passengerCompensationTotal ?? null,
            platformPenalty: result?.platform_penalty ?? result?.platformPenalty ?? null,
            stripeRefunded: response?.stripeRefunded ?? result?.stripeRefunded ?? null,
            refundAmounts: result?.refund_amounts ?? result?.refundAmounts ?? {},
            raw: response ?? null
        };
    } catch (err) {
        console.error("🛡️ [Ride Lifecycle] cancelRide failed:", err);
        throw err;
    }
};

export const cancelBooking = async (rideId) => {
    const { data, success, error } = await rpc.cancelBookingAndRefund(rideId);
    if (!success) throw new Error(error);
    const response = assertBusinessSuccess(data, 'No se pudo cancelar la reserva');
    const result = response?.details || response;
    assertBusinessSuccess(result, 'No se pudo cancelar la reserva');
    return {
        success: result?.success ?? true,
        status: result?.status || 'cancelled',
        refunded: result?.refunded ?? result?.refund_amount ?? result?.refundAmount ?? null,
        penalty: result?.penalty ?? result?.penalty_amount ?? result?.penaltyAmount ?? null,
        driverCompensation: result?.driver_compensation ?? result?.driverCompensation ?? null,
        platformPenalty: result?.platform_penalty ?? result?.platformPenalty ?? null,
        stripeRefunded: response?.stripeRefunded ?? result?.stripeRefunded ?? null,
        alreadyCancelled: result?.already_cancelled ?? result?.alreadyCancelled ?? false,
        data: result,
        raw: response ?? null,
    };
};

export const verifyPassenger = async (rideId, passengerId, pin) => {
    const cleanPin = String(pin || '').replace(/\D/g, '');
    const { success, error } = await rpc.verifyPassenger(rideId, cleanPin, passengerId ?? null);
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

    if (routeData.id) payload.id = routeData.id;

    const { data, success, error } = await rpc.safeCall(
        () => supabase.from('favorite_routes').upsert(payload).select().single(),
        'upsert_favorite_route'
    );

    if (!success) throw new Error(error);
    return data;
};
