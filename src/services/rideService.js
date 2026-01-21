/**
 * Servicio de Viajes (Rides) - Blindaje de Integridad v8 (Principal Engineer Edition)
 */

import { supabase } from '../lib/supabase';
import * as rpc from '@/lib/supabaseRPC';

/**
 * Normaliza objetos de ubicación para evitar errores de esquema en Postgres
 */
const normalizeLocation = (loc) => ({
    address: loc?.address || '',
    name: loc?.name || loc?.address?.split(',')[0] || 'Ubicación',
    lat: parseFloat(loc?.coordinates?.lat || loc?.lat || 0),
    lng: parseFloat(loc?.coordinates?.lng || loc?.lng || 0)
});

/**
 * Crea un nuevo viaje oficial con validación defensiva.
 */
export const createSingleRide = async (rideData) => {
    try {
        const rideParams = {
            origin: normalizeLocation(rideData.origin),
            destination: normalizeLocation(rideData.destination),
            waypoints: (rideData.waypoints || []).map(normalizeLocation),
            dateTime: rideData.dateTime instanceof Date ? rideData.dateTime.toISOString() : rideData.dateTime,
            seats: parseInt(rideData.seats || 1),
            price: parseFloat(rideData.price || 0),
            distance: parseFloat(rideData.distance || 0),
            overview_polyline: rideData.overview_polyline || '',
            details: rideData.details || '',
            isWomenOnly: !!rideData.isWomenOnly,
            approvalMode: rideData.approvalMode || 'automatic',
            preferences: rideData.preferences || {}
        };

        const { data, success, error } = await rpc.createRide(rideParams);
        if (!success) throw new Error(error);
        return data.rideId;
    } catch (error) {
        console.error("🛡️ [Offer Flow] createSingleRide failed:", error);
        throw error;
    }
};

/**
 * Crea una solicitud de viaje (Passenger Request) usando el wrapper seguro.
 */
export const createRideRequest = async (requestData) => {
    try {
        const payload = {
            p_origin: normalizeLocation(requestData.origin),
            p_destination: normalizeLocation(requestData.destination),
            p_departure_time: requestData.dateTime instanceof Date ? requestData.dateTime.toISOString() : requestData.dateTime,
            p_seats_needed: parseInt(requestData.seats || 1),
            p_suggested_price: parseFloat(requestData.price || 0),
            p_details: requestData.note || '',
            p_is_women_only: !!requestData.isWomenOnly,
            p_distance: parseFloat(requestData.distance || 0),
            p_overview_polyline: requestData.overview_polyline || ''
        };

        const { data, success, error } = await rpc.safeCall(
            supabase.rpc('create_ride_request', payload),
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
            supabase.rpc('submit_reviews', {
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

export const getAvailableRides = async () => {
    try {
        const { data, error } = await supabase.rpc('get_available_rides_v2');
        if (error) throw error;
        return data || [];
    } catch (error) {
        console.error("🛡️ stability: getAvailableRides failed:", error);
        return [];
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
    const { data, success, error } = await rpc.fulfillRideRequest(rideData);
    if (!success) throw new Error(error);
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

export const verifyPassenger = async (rideId, passengerId, pin) => {
    const { success, error } = await rpc.verifyPassenger(rideId, passengerId, pin);
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
    const { data, error } = await supabase.rpc('handle_passenger_no_show', { p_ride_id: rideId, p_passenger_id: passengerId });
    if (error) throw new Error(error.message);
    return data;
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

export const searchRides = async ({ origin, destination, date, seats = 1, maxPrice = 999.99, radius = 15000 }) => {
    const { data, success, error } = await rpc.searchRides(origin, destination, date, seats, maxPrice, radius);
    if (!success) throw new Error(error);
    return (data || []).map(ride => ({
        ...ride,
        type: 'ride',
        driver: {
            id: ride.driver_id,
            display_name: ride.driver_display_name,
            photo_url: ride.driver_photo_url,
            rating: ride.driver_rating,
            eco_tier: ride.driver_eco_tier,
            verification: { status: ride.driver_verified }
        }
    }));
};
