import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.test' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
const supabaseDriver = createClient(supabaseUrl, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const supabasePassenger = createClient(supabaseUrl, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });

const PASS = 'ShareWayTest2026!';
const DRIVER_EMAIL = 'driver.elite@shareway.test';
const PASSENGER_EMAIL = 'passenger.1@shareway.test';

describe('🚀 PRODUCTION READY - Final Integration Audit (GIGA-SYNC)', () => {
    let driverId, passengerId;
    let testRideId;
    let testRequestId;

    beforeAll(async () => {
        // Auth
        const { data: dData } = await supabaseDriver.auth.signInWithPassword({ email: DRIVER_EMAIL, password: PASS });
        const { data: pData } = await supabasePassenger.auth.signInWithPassword({ email: PASSENGER_EMAIL, password: PASS });

        driverId = dData.user.id;
        passengerId = pData.user.id;

        // Cleanup
        await supabaseAdmin.from('rides').delete().eq('driver_id', driverId);
        await supabaseAdmin.from('ride_requests').delete().eq('requester_id', passengerId);

        // Reset Wallets
        await supabaseAdmin.from('wallets').upsert([
            { user_id: driverId, balance: 100, held_balance: 0 },
            { user_id: passengerId, balance: 500, held_balance: 0 }
        ]);

        // Ensure Profiles are verified for production rules
        await supabaseAdmin.rpc('admin_update_user_status', {
            p_user_id: driverId,
            p_status: 'verified'
        });
        await supabaseAdmin.rpc('admin_update_user_status', {
            p_user_id: passengerId,
            p_status: 'verified'
        });
    });

    describe('1. Advanced Ride Creation (with Waypoints)', () => {
        it('should create a ride with waypoints and correct schema', async () => {
            const departureTime = new Date();
            departureTime.setDate(departureTime.getDate() + 2);

            const { data, error } = await supabaseDriver.rpc('create_ride', {
                p_origin: { address: 'Calle Mayor, Madrid', lat: 40.4168, lng: -3.7038 },
                p_destination: { address: 'Puerto de Valencia', lat: 39.4697, lng: -0.3763 },
                p_departure_time: departureTime.toISOString(),
                p_seats: 3,
                p_price: 30.00,
                p_distance: 360,
                p_details: 'Viaje con paradas intermedias',
                p_waypoints: [
                    { address: 'Tarancón', lat: 40.0076, lng: -3.0118 },
                    { address: 'Utiel', lat: 39.5674, lng: -1.2045 }
                ]
            });

            expect(error).toBeNull();
            expect(data.success).toBe(true);
            testRideId = data.rideId;

            // Verify record in DB
            const { data: ride } = await supabaseAdmin.from('rides').select('*').eq('id', testRideId).single();
            expect(ride.waypoints).toHaveLength(2);
            expect(ride.waypoints[0].address).toBe('Tarancón');
            expect(ride.seats_total).toBe(3);
        });
    });

    describe('2. Elite Search Engine (search_rides_secure)', () => {
        it('should find the newly created ride via proximity search', async () => {
            const { data, error } = await supabasePassenger.rpc('search_rides_secure', {
                p_origin: { lat: 40.41, lng: -3.70 }, // Close to Madrid
                p_destination: { lat: 39.46, lng: -0.37 }, // Close to Valencia
                p_seats_needed: 1,
                p_max_dist_meters: 20000 // 20km radius
            });

            expect(error).toBeNull();
            expect(data.length).toBeGreaterThan(0);
            const foundRide = data.find(r => r.id === testRideId);
            expect(foundRide).toBeDefined();
            expect(foundRide.match_score).toBeGreaterThan(0);
        });

        it('should filter out rides if seats_needed exceeds available', async () => {
            const { data } = await supabasePassenger.rpc('search_rides_secure', {
                p_origin: { lat: 40.41, lng: -3.70 },
                p_destination: { lat: 39.46, lng: -0.37 },
                p_seats_needed: 10 // More than 3
            });
            const foundRide = data.find(r => r.id === testRideId);
            expect(foundRide).toBeUndefined();
        });
    });

    describe('3. Ride Requests & Fulfillment Flow', () => {
        it('should allow a passenger to publish a ride request', async () => {
            const departureTime = new Date();
            departureTime.setDate(departureTime.getDate() + 3);

            const { data, error } = await supabasePassenger.rpc('create_ride_request', {
                p_origin: { address: 'Sevilla', lat: 37.3891, lng: -5.9845 },
                p_destination: { address: 'Málaga', lat: 36.7213, lng: -4.4214 },
                p_departure_time: departureTime.toISOString(),
                p_seats_needed: 2,
                p_suggested_price: 15.00,
                p_details: 'Busco conductor flexible'
            });

            expect(error).toBeNull();
            expect(data.success).toBe(true);
            testRequestId = data.requestId;
        });

        it('should allow a driver to fulfill the request atomitically', async () => {
            // Find request first
            const { data: searchResults } = await supabaseDriver.rpc('search_ride_requests_secure', {
                p_origin: { lat: 37.38, lng: -5.98 },
                p_destination: { lat: 36.72, lng: -4.42 },
                p_max_dist_meters: 10000
            });

            const req = searchResults.find(r => r.id === testRequestId);
            expect(req).toBeDefined();

            // Fulfill it
            const { data: fulfillRes, error } = await supabaseDriver.rpc('fulfill_ride_request', {
                p_request_id: testRequestId,
                p_origin: req.origin,
                p_destination: req.destination,
                p_departure_time: req.departure_time,
                p_seats: 4,
                p_price: 15.00,
                p_distance: 200,
                p_waypoints: []
            });

            expect(error).toBeNull();
            expect(fulfillRes.success).toBe(true);

            // Verify request status
            const { data: requestInDb } = await supabaseAdmin.from('ride_requests').select('status, matched_ride_id').eq('id', testRequestId).single();
            expect(requestInDb.status).toBe('accepted');
            expect(requestInDb.matched_ride_id).toBeDefined();
        });
    });

    describe('4. Real-time Telemetry (update_ride_location)', () => {
        it('should update current_location with numeric lat/lng signature', async () => {
            const { data, error } = await supabaseDriver.rpc('update_ride_location', {
                p_ride_id: testRideId,
                p_lat: 40.5,
                p_lng: -3.5
            });

            expect(error).toBeNull();
            expect(data.success).toBe(true);

            const { data: ride } = await supabaseAdmin.from('rides').select('current_location').eq('id', testRideId).single();
            expect(ride.current_location.lat).toBe(40.5);
        });
    });

    describe('5. Platform Administration', () => {
        it('should allow fetching platform stats', async () => {
            const { data, error } = await supabaseAdmin.rpc('get_platform_stats');
            expect(error).toBeNull();
            expect(data.success).toBe(true);
            expect(data.stats.totalUsers).toBeGreaterThan(0);
        });
    });
});
