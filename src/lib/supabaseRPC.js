import { supabase } from './supabase';

const sanitizeError = (value, fallback = 'La operación fue rechazada por el servidor') => {
    const raw = String(value || fallback);
    return raw.replace(/eyJ[a-zA-Z0-9._-]+/g, '[TOKEN_HIDDEN]');
};

const getBusinessFailure = (data) => {
    const payload = Array.isArray(data) && data.length === 1 ? data[0] : data;

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
    if (payload.success !== false) return null;

    return sanitizeError(
        payload.error || payload.message || payload.code,
        'La operación no pudo completarse.'
    );
};

/**
 * Enhanced Safe RPC Wrapper with Retries and Dynamic Timeout.
 * Treats both PostgREST errors and JSON business responses with success=false
 * as failed operations, so the UI cannot report a rejected mutation as successful.
 */
export const safeCall = async (rpcCall, functionName, retries = 2) => {
    const CRITICAL_FUNCTIONS = ['confirm_trip_and_pay', 'add_funds', 'process_payout', 'create_ride', 'start_ride', 'handle_passenger_no_show', 'cancel_ride', 'cancel_booking_and_refund', 'trigger_emergency_alert'];
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

            if (!result || typeof result !== 'object') {
                const cleanError = 'Respuesta inválida del servidor';
                console.error(`🛡️ RPC Error [${functionName}]:`, cleanError);
                return { data: null, error: cleanError, success: false };
            }

            if (result.error) {
                const cleanError = sanitizeError(result.error.message || result.error);
                console.error(`🛡️ RPC Error [${functionName}]:`, cleanError);
                return { data: null, error: cleanError, success: false };
            }

            const businessFailure = getBusinessFailure(result.data);
            if (businessFailure) {
                console.warn(`🛡️ RPC Business Failure [${functionName}]:`, businessFailure);
                return { data: result.data, error: businessFailure, success: false };
            }

            return { data: result.data, error: null, success: true };
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err || 'Error de conexión');
            if (attempt < retries && (message.includes('Timeout') || message.includes('fetch'))) {
                console.warn(`⚠️ Retrying ${functionName} (${attempt + 1}/${retries})...`);
                return executeCall(attempt + 1);
            }
            return { data: null, error: sanitizeError(message, 'Error de conexión'), success: false };
        }
    };

    return executeCall(0);
};

const normalizeRideStartError = (error, readiness = null) => {
    const raw = String(error || '');
    if (raw.includes('PIN_VERIFICATION_REQUIRED')) {
        const count = Number(readiness?.unresolved_count || 0);
        return count > 0
            ? `Debes verificar el PIN o resolver el no-show de ${count} pasajero(s) antes de iniciar.`
            : 'Debes verificar todos los PIN o resolver los no-show antes de iniciar.';
    }
    return raw || 'No se pudo iniciar el viaje';
};

// --- USER-FACING RPCs ---
export const getRideStartReadiness = (rideId) =>
    safeCall(() => supabase.rpc('get_ride_start_readiness', {
        p_ride_id: rideId
    }), 'get_ride_start_readiness');

export const startRide = async (rideId, driverId = null) => {
    const readinessResponse = await getRideStartReadiness(rideId);
    const readiness = readinessResponse?.data;

    if (!readinessResponse.success) {
        return {
            data: null,
            success: false,
            error: readinessResponse.error || 'No se pudo comprobar el embarque antes de iniciar.'
        };
    }

    if (readiness?.ready === false) {
        return {
            data: readiness,
            success: false,
            error: normalizeRideStartError('PIN_VERIFICATION_REQUIRED', readiness)
        };
    }

    const result = await safeCall(() => supabase.rpc('start_ride', {
        p_ride_id: rideId,
        p_driver_id: driverId
    }), 'start_ride');

    if (!result.success) {
        return {
            ...result,
            error: normalizeRideStartError(result.error, readiness)
        };
    }

    return { ...result, readiness };
};

export const updateRideLocation = (rideId, lat, lng, heading = 0) =>
    safeCall(() => supabase.rpc('update_ride_location', {
        p_ride_id: rideId,
        p_lat: parseFloat(lat),
        p_lng: parseFloat(lng),
        p_heading: parseFloat(heading || 0)
    }), 'update_ride_location');

export const completeRide = (rideId) =>
    safeCall(() => supabase.rpc('complete_ride', { p_ride_id: rideId }), 'complete_ride');

/**
 * Cancela el viaje (Conductor). Unificado.
 */
export const cancelRide = (rideId) =>
    safeCall(() => supabase.rpc('cancel_ride', { p_ride_id: rideId }), 'cancel_ride');

export const triggerEmergencyAlert = (rideId, details) =>
    safeCall(() => supabase.rpc('trigger_emergency_alert', {
        p_ride_id: rideId,
        p_details: details
    }), 'trigger_emergency_alert');

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

export const confirmTripAndPay = (rideId, requestId = null, { pickupLocation = null, pickupAddress = null, dropoffLocation = null, dropoffAddress = null, price = null, numSeats = 1 } = {}) =>
    safeCall(() => supabase.rpc('confirm_trip_and_pay', {
        p_ride_id: rideId,
        p_request_id: requestId ?? null,
        p_pickup_address: pickupAddress ?? null,
        p_pickup_location: pickupLocation ?? null,
        p_dropoff_address: dropoffAddress ?? null,
        p_dropoff_location: dropoffLocation ?? null,
        p_price: price !== null ? parseFloat(price) : null,
        p_num_seats: parseInt(numSeats || 1)
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

export const getOrCreateChat = (otherUserId, rideId = null) =>
    safeCall(() => supabase.rpc('get_or_create_chat_v2', {
        p_other_user_id: otherUserId,
        p_ride_id: rideId
    }), 'get_or_create_chat_v2');

// --- ADMIN & MANAGEMENT RPCs ---
export const adminUpdateUserStatus = (userId, status) =>
    safeCall(() => supabase.rpc('admin_update_user_status', { p_user_id: userId, p_status: status }), 'admin_update_user_status');

export const adminToggleUserSuspension = (userId, suspend) =>
    safeCall(() => supabase.rpc('admin_toggle_user_suspension', { p_user_id: userId, p_suspend: suspend }), 'admin_toggle_user_suspension');

export const getAdminHealthDashboard = () =>
    safeCall(() => supabase.rpc('get_admin_health_dashboard'), 'get_admin_health_dashboard');

export const getPlatformStats = () =>
    safeCall(() => supabase.rpc('get_platform_admin_stats'), 'get_platform_admin_stats');

export const runManualMaintenanceTasks = () =>
    safeCall(() => supabase.rpc('run_manual_maintenance_tasks'), 'run_manual_maintenance_tasks');

export const getPlatformSettings = () =>
    safeCall(() => supabase.rpc('get_platform_settings'), 'get_platform_settings');

export const updatePlatformSetting = (key, value) =>
    safeCall(() => supabase.rpc('update_platform_setting', { p_key: key, p_value: value }), 'update_platform_setting');

export const getPlatformAuditLogs = (category = 'all', limit = 50) =>
    safeCall(() => supabase.rpc('get_filtered_audit_logs', { p_category: category, p_limit: limit }), 'get_filtered_audit_logs');

export const requestPlatformPayout = () =>
    safeCall(() => supabase.rpc('request_platform_payout'), 'request_platform_payout');

export const processPayout = (payoutId, status, errorMessage = null) =>
    safeCall(() => supabase.rpc('process_payout', {
        p_payout_id: payoutId,
        p_status: status,
        p_error_message: errorMessage
    }), 'process_payout');

export const processPayoutElite = (payoutId, action, notes = null) =>
    safeCall(() => supabase.rpc('process_payout_elite', {
        p_payout_id: payoutId,
        p_action: action,
        p_notes: notes
    }), 'process_payout_elite');

export const getPayoutRequests = () =>
    safeCall(() => supabase
        .from('payout_requests')
        .select('*, profiles(display_name, email)')
        .order('created_at', { ascending: false }), 'get_payout_requests');

export const getPendingVerifications = () =>
    safeCall(() => supabase
        .from('profiles')
        .select('*')
        .eq('verification->>status', 'pending')
        .order('created_at', { ascending: false }), 'get_pending_verifications');

export const getRideManagementList = (statusFilter = 'all') => {
    let query = supabase
        .from('rides')
        .select('*, profiles:driver_id(display_name)')
        .order('departure_time', { ascending: false });

    if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
    }

    return safeCall(() => query.limit(50), 'get_ride_management_list');
};

export const getDisputesList = () =>
    safeCall(() => supabase
        .from('cancellation_disputes')
        .select(`
            *,
            user:profiles!user_id(display_name, email),
            ride:rides(id, origin, destination, departure_time)
        `)
        .order('created_at', { ascending: false }), 'get_disputes_list');

export const resolveDispute = (disputeId, status, adminNotes = null) =>
    safeCall(() => supabase.rpc('resolve_dispute_v2', {
        p_dispute_id: disputeId,
        p_status: status,
        p_admin_notes: adminNotes
    }), 'resolve_dispute_v2');

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
export const createStripeConnectOnboarding = async (returnUrl) => {
    try {
        const { data, error } = await supabase.functions.invoke('create-stripe-account-link', {
            body: { return_url: returnUrl || window.location.href }
        });
        if (error) throw error;
        return { success: true, data };
    } catch (e) {
        console.error("Stripe Onboarding Error:", e);
        return { success: false, error: e.message };
    }
};
