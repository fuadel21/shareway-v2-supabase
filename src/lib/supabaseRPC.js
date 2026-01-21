import { createClient } from '@supabase/supabase-js';
import { supabase } from './supabase';

/**
 * Safe RPC Wrapper
 */
export const safeCall = async (rpcPromise, functionName) => {
    const TIMEOUT_MS = 15000; // Incrementado ligeramente para evitar falsos positivos
    try {
        const result = await Promise.race([
            rpcPromise,
            new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout en ${functionName}`)), TIMEOUT_MS))
        ]);

        if (result.error) {
            console.error(`🛡️ RPC Error [${functionName}]:`, result.error);
            return { data: null, error: result.error.message, success: false };
        }

        return { data: result.data, error: null, success: true };
    } catch (err) {
        console.error(`🛡️ Critical RPC Failure [${functionName}]:`, err);
        return { data: null, error: err.message || "Error de conexión", success: false };
    }
};

// --- USER-FACING RPCs ---
export const acceptRequest = (requestId, rideId) =>
    safeCall(supabase.rpc('accept_request', { p_request_id: requestId, p_ride_id: rideId }), 'accept_request');

export const createRide = (rideData) =>
    safeCall(supabase.rpc('create_ride', {
        p_origin: rideData.origin,
        p_destination: rideData.destination,
        p_departure_time: rideData.dateTime,
        p_seats: rideData.seats,
        p_price: rideData.price,
        p_distance: rideData.distance,
        p_overview_polyline: rideData.overview_polyline,
        p_details: rideData.details,
        p_is_women_only: rideData.isWomenOnly || false,
        p_approval_mode: rideData.approvalMode || 'automatic',
        p_waypoints: rideData.waypoints || [],
        p_preferences: rideData.preferences || {}
    }), 'create_ride');

export const fulfillRideRequest = (rideData) =>
    safeCall(supabase.rpc('fulfill_ride_request', {
        p_request_id: rideData.requestId,
        p_origin: rideData.origin,
        p_destination: rideData.destination,
        p_departure_time: rideData.dateTime,
        p_seats: rideData.seats,
        p_price: rideData.price,
        p_distance: rideData.distance,
        p_overview_polyline: rideData.overview_polyline,
        p_details: rideData.details,
        p_waypoints: rideData.waypoints || []
    }), 'fulfill_ride_request');

/**
 * Confirmación de viaje y pago.
 * @param {string} rideId 
 * @param {string|null} requestId - Opcional, necesario si viene de una solicitud previa.
 */
export const confirmTripAndPay = (rideId, requestId = null) =>
    safeCall(supabase.rpc('confirm_trip_and_pay', { p_ride_id: rideId, p_request_id: requestId }), 'confirm_trip_and_pay');

export const cancelBookingAndRefund = (rideId) =>
    safeCall(supabase.rpc('cancel_booking_and_refund', { p_ride_id: rideId }), 'cancel_booking_and_refund');

export const startRide = (rideId) =>
    safeCall(supabase.rpc('start_ride', { p_ride_id: rideId }), 'start_ride');

export const completeRide = (rideId) =>
    safeCall(supabase.rpc('complete_ride', { p_ride_id: rideId }), 'complete_ride');

export const cancelRide = (rideId) =>
    safeCall(supabase.rpc('cancel_ride', { p_ride_id: rideId }), 'cancel_ride');

export const getUserRides = () =>
    safeCall(supabase.rpc('get_user_rides'), 'get_user_rides');

export const verifyPassenger = (rideId, passengerId, pin) =>
    safeCall(supabase.rpc('verify_passenger', { p_ride_id: rideId, p_passenger_id: passengerId, p_pin: pin }), 'verify_passenger');

export const getRideDetailsSecure = (rideId) =>
    safeCall(supabase.rpc('get_ride_details_secure', { p_ride_id: rideId }), 'get_ride_details_secure');

export const getMyRidePin = (rideId) =>
    safeCall(supabase.rpc('get_my_ride_pin', { p_ride_id: rideId }), 'get_my_ride_pin');

export const searchRides = (origin, destination, date, seats = 1, maxPrice = 999.99, radius = 15000) =>
    safeCall(supabase.rpc('search_rides_secure', {
        p_origin: origin,
        p_destination: destination,
        p_date: date,
        p_seats_needed: seats,
        p_max_price: maxPrice,
        p_max_dist_meters: radius
    }), 'search_rides_secure');

export const confirmPassengerArrival = (rideId) =>
    safeCall(supabase.rpc('confirm_passenger_arrival', { p_ride_id: rideId }), 'confirm_passenger_arrival');

// Wallet operations
export const addFunds = (amount, paymentMethodId) =>
    safeCall(supabase.rpc('add_funds', { p_amount: amount, p_payment_method_id: paymentMethodId }), 'add_funds');

export const requestPayout = (amount) =>
    safeCall(supabase.rpc('request_payout', { p_amount: amount }), 'request_payout');

// Ride passenger management
export const removePassenger = (rideId, passengerId) =>
    safeCall(supabase.rpc('remove_passenger', { p_ride_id: rideId, p_passenger_id: passengerId }), 'remove_passenger');

// --- FUNCIONES RESTAURADAS PARA ADMIN & FEATURES ---
// Estas funciones utilizan RPC con SECURITY DEFINER que verifican internamente
// los permisos (is_admin o propietario), por lo que son seguras de llamar desde el cliente.

export const searchUsers = (searchTerm) =>
    safeCall(supabase.rpc('search_users', { p_search_term: searchTerm }), 'search_users');

export const getPlatformStats = () =>
    safeCall(supabase.rpc('get_platform_stats'), 'get_platform_stats');

export const runManualMaintenanceTasks = () =>
    safeCall(supabase.rpc('run_manual_maintenance_tasks'), 'run_manual_maintenance_tasks');

export const cancelRideRequest = (requestId) =>
    safeCall(supabase.rpc('cancel_ride_request', { p_request_id: requestId }), 'cancel_ride_request');

export const createStripeConnectOnboarding = (returnUrl) =>
    safeCall(supabase.rpc('create_stripe_connect_onboarding', { p_return_url: returnUrl }), 'create_stripe_connect_onboarding');

export const createPayoutRequest = (amount) =>
    safeCall(supabase.rpc('create_payout_request', { p_amount: amount }), 'create_payout_request');

// Mocks para funciones aún no implementadas en backend
export const requestPlatformPayout = () => {
    console.warn('requestPlatformPayout no implementado aún');
    return Promise.resolve({ success: false, message: 'Función no disponible temporalmente.' });
};

export const getAdminHealthDashboard = () => {
    console.warn('getAdminHealthDashboard no implementado aún');
    return Promise.resolve({ success: false, message: 'Función no disponible temporalmente.' });
};
