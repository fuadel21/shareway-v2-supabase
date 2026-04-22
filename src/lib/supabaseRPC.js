import { supabase } from './supabase';

/**
 * Enhanced Safe RPC Wrapper with Retries and Dynamic Timeout
 */
export const safeCall = async (rpcCall, functionName, retries = 2) => {
    const CRITICAL_FUNCTIONS = ['confirm_trip_and_pay', 'add_funds', 'process_payout', 'create_ride', 'start_ride', 'handle_passenger_no_show', 'cancel_ride', 'cancel_booking_and_refund'];
    const TIMEOUT_MS = CRITICAL_FUNCTIONS.includes(functionName) ? 25000 : 15000;

    const executeCall = async (attempt) => {
        try {
            const promise = typeof rpcCall === 'function' ? rpcCall() : rpcCall;
            const result = await Promise.race([
                promise,
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error(`Timeout: La operación ${functionName} tarda demasiado.`)), TIMEOUT_MS)
                )
            ]);

            if (result.error) {
                const cleanError = result.error.message?.replace(/eyJ[a-zA-Z0-9._-]+/g, '[TOKEN_HIDDEN]');
                console.error(`🛡️ RPC Error [${functionName}]:`, cleanError);
                return { data: null, error: cleanError, success: false };
            }

            return { data: result.data, error: null, success: true };
        } catch (err) {
            if (attempt < retries && (err.message.includes('Timeout') || err.message.includes('fetch'))) {
                console.warn(`⚠️ Retrying ${functionName} (${attempt + 1}/${retries})...`);
                return executeCall(attempt + 1);
            }
            return { data: null, error: err.message || "Error de conexión", success: false };
        }
    };

    return executeCall(0);
};

// --- USER-FACING RPCs ---
export const startRide = (rideId) =>
    safeCall(() => supabase.rpc('start_ride', { p_ride_id: rideId }), 'start_ride');

export const updateRideLocation = (rideId, lat, lng) =>
    safeCall(() => supabase.rpc('update_ride_location', {
        p_ride_id: rideId,
        p_lat: parseFloat(lat),
        p_lng: parseFloat(lng)
    }), 'update_ride_location');

export const completeRide = (rideId) =>
    safeCall(() => supabase.rpc('complete_ride', { p_ride_id: rideId }), 'complete_ride');

/**
 * Cancela el viaje (Conductor). Unificado.
 */
export const cancelRide = (rideId) =>
    safeCall(() => supabase.rpc('cancel_ride', { p_ride_id: rideId }), 'cancel_ride');

export const getRideDetailsSecure = (rideId) =>
    safeCall(() => supabase.rpc('get_ride_details_secure', { p_ride_id: rideId }), 'get_ride_details_secure');

export const verifyPassenger = (rideId, pin, passengerId = null) =>
    safeCall(() => supabase.rpc('verify_passenger_boarding', {
        p_ride_id: rideId,
        p_pin: pin,
        p_passenger_id: passengerId
    }), 'verify_passenger_boarding');

export const getMyRidePin = (rideId) =>
    safeCall(() => supabase.rpc('get_my_ride_pin', { p_ride_id: rideId }), 'get_my_ride_pin');

export const removePassenger = (rideId, passengerId) =>
    safeCall(() => supabase.rpc('remove_passenger', { p_ride_id: rideId, p_passenger_id: passengerId }), 'remove_passenger');

export const acceptPassenger = (rideId, passengerId) =>
    safeCall(() => supabase.rpc('accept_passenger', { p_ride_id: rideId, p_passenger_id: passengerId }), 'accept_passenger');

export const rejectPassenger = (rideId, passengerId) =>
    safeCall(() => supabase.rpc('reject_passenger', { p_ride_id: rideId, p_passenger_id: passengerId }), 'reject_passenger');

export const getUserRides = (userId = null) =>
    safeCall(() => supabase.rpc('get_user_rides', { p_user_id: userId, p_role: 'all' }), 'get_user_rides');

export const createRide = (rideData) =>
    safeCall(() => supabase.rpc('create_ride', {
        p_origin: rideData.origin,
        p_destination: rideData.destination,
        p_departure_time: rideData.dateTime.toISOString(),
        p_seats: rideData.seats,
        p_price: rideData.price,
        p_details: rideData.details || '',
        p_distance: rideData.distance || 0,
        p_overview_polyline: rideData.overview_polyline || '',
        p_waypoints: rideData.waypoints || [],
        p_idempotency_key: rideData.idempotency_key || null
    }), 'create_ride');

export const confirmTripAndPay = (rideId, requestId = null, { pickupLocation = null, pickupAddress = null, price = null } = {}) =>
    safeCall(() => supabase.rpc('confirm_trip_and_pay', {
        p_ride_id: rideId,
        // Siempre enviar las claves para evitar que el cliente omita nulls y quede solo p_ride_id
        // (ambigüedad entre sobrecargas en PostgreSQL).
        p_request_id: requestId ?? null,
        p_pickup_location: pickupLocation ?? null,
        p_pickup_address: pickupAddress ?? null,
        p_price: price ?? null
    }), 'confirm_trip_and_pay');

export const cancelBookingAndRefund = (rideId) =>
    safeCall(() => supabase.rpc('cancel_booking_and_refund', { p_ride_id: rideId }), 'cancel_booking_and_refund');

export const confirmPassengerArrival = (rideId) =>
    safeCall(() => supabase.rpc('confirm_passenger_arrival', { p_ride_id: rideId }), 'confirm_passenger_arrival');

export const searchRides = (origin, destination, date = null, seats = 1, maxPrice = 999.99, radius = 15000) =>
    safeCall(() => supabase.rpc('search_rides_secure', {
        p_origin: origin,
        p_destination: destination,
        p_date: date,
        p_seats_needed: seats,
        p_max_price: maxPrice,
        p_max_dist_meters: radius
    }), 'search_rides_secure');

export const searchRideRequests = (origin, destination, date = null, seats = 1, maxDist = 15000) =>
    safeCall(() => supabase.rpc('search_ride_requests_secure', {
        p_origin: origin,
        p_destination: destination,
        p_date: date,
        p_seats_min: seats,
        p_max_dist_meters: maxDist
    }), 'search_ride_requests_secure');

export const fulfillRideRequest = (rideData) =>
    safeCall(() => supabase.rpc('fulfill_ride_request', {
        p_request_id: rideData.requestId,
        p_origin: rideData.origin,
        p_destination: rideData.destination,
        p_departure_time: rideData.dateTime.toISOString(),
        p_seats: rideData.seats,
        p_price: rideData.price,
        p_details: rideData.details || '',
        p_distance: rideData.distance || 0,
        p_overview_polyline: rideData.overview_polyline || '',
        p_waypoints: rideData.waypoints || []
    }), 'fulfill_ride_request');

// --- ADMIN & MANAGEMENT RPCs ---
export const adminUpdateUserStatus = (userId, status) =>
    safeCall(() => supabase.rpc('admin_update_user_status', { p_user_id: userId, p_status: status }), 'admin_update_user_status');

export const adminToggleUserSuspension = (userId, suspend) =>
    safeCall(() => supabase.rpc('admin_toggle_user_suspension', { p_user_id: userId, p_suspend: suspend }), 'admin_toggle_user_suspension');

export const getAdminHealthDashboard = () =>
    safeCall(() => supabase.rpc('get_admin_health_dashboard'), 'get_admin_health_dashboard');

export const getPlatformStats = () =>
    safeCall(() => supabase.rpc('get_platform_stats'), 'get_platform_stats');

export const runManualMaintenanceTasks = () =>
    safeCall(() => supabase.rpc('run_manual_maintenance_tasks'), 'run_manual_maintenance_tasks');

export const getPlatformSettings = () =>
    safeCall(() => supabase.rpc('get_platform_settings'), 'get_platform_settings');

export const updatePlatformSetting = (key, value) =>
    safeCall(() => supabase.rpc('update_platform_setting', { p_key: key, p_value: value }), 'update_platform_setting');

export const getPlatformAuditLogs = (limit = 50) =>
    safeCall(() => supabase.rpc('get_platform_audit_logs', { p_limit: limit }), 'get_platform_audit_logs');

export const requestPlatformPayout = () =>
    safeCall(() => supabase.rpc('request_platform_payout'), 'request_platform_payout');

export const addFunds = (amount, paymentMethodId) =>
    safeCall(() => supabase.rpc('add_funds', { p_amount: amount, p_payment_method_id: paymentMethodId }), 'add_funds');

export const confirmStripeBooking = (rideId, paymentIntentId, pickupLocation = null, pickupAddress = null) =>
    safeCall(() => supabase.rpc('confirm_stripe_booking', {
        p_ride_id: rideId,
        p_payment_intent_id: paymentIntentId,
        p_pickup_location: pickupLocation,
        p_pickup_address: pickupAddress
    }), 'confirm_stripe_booking');

export const requestPayout = (amount) =>
    safeCall(() => supabase.rpc('request_payout', { p_amount: amount }), 'request_payout');

export const createPayoutRequest = requestPayout;

export const searchUsers = async (searchTerm) => {
    const { data, success } = await safeCall(() => supabase.rpc('search_users', { p_search_term: searchTerm }), 'search_users');
    if (success && data) {
        // Map robust SQL names back to UI-friendly names
        const mappedData = data.map(u => ({
            id: u.user_id,
            display_name: u.user_display_name,
            email: u.user_email,
            photo_url: u.user_photo_url,
            role: u.user_role,
            is_suspended: u.user_is_suspended,
            verification: u.user_verification,
            is_admin: u.user_is_admin,
            created_at: u.user_created_at
        }));
        return mappedData;
    }
    return [];
};

export const cancelRideRequest = (requestId) =>
    safeCall(() => supabase.rpc('cancel_ride_request', { p_request_id: requestId }), 'cancel_ride_request');

export const handlePassengerNoShow = (rideId, passengerId) =>
    safeCall(() => supabase.rpc('handle_passenger_no_show', { 
        p_ride_id: rideId, 
        p_passenger_id: passengerId 
    }), 'handle_passenger_no_show');

// --- EXTERNAL INTEGRATIONS ---
export const createStripeConnectOnboarding = async () => {
    try {
        const { data, error } = await supabase.functions.invoke('create-stripe-account-link');
        if (error) throw error;
        return { success: true, data };
    } catch (e) { return { success: false, error: e.message }; }
};
