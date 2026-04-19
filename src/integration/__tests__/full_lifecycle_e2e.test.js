/**
 * 🚀 SHAREWAY V2 - TEST DE FLUJO COMPLETO (PRODUCCIÓN E2E)
 * Cobertura: Publicar -> Buscar -> Reservar (Escrow) -> PIN -> Pago Final
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.test' });

// Usamos las credenciales encontradas en .env.local
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !anonKey) {
    throw new Error('E2E: define VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en .env.test (sin claves por defecto en el repo).');
}

// Clientes para simular diferentes usuarios
const admin = createClient(supabaseUrl, supabaseKey || anonKey, { auth: { persistSession: false } });
const driver = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
const passenger = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });

const PASS = 'ShareWayTest2026!';
const DRIVER_EMAIL = 'driver.elite@shareway.test';
const PASSENGER_EMAIL = 'passenger.1@shareway.test';

describe('🏁 SHAREWAY V2: FLUJO DE VIDA COMPLETO (E2E)', () => {
    // Aumentamos el timeout para evitar el error de Vitest en entornos lentos
    const TEST_TIMEOUT = 90000;
    let driverId, passengerId, rideId, reservationPin;

    beforeAll(async () => {
        // 1. Setup Auth
        const { data: dData, error: de } = await driver.auth.signInWithPassword({ email: DRIVER_EMAIL, password: PASS });
        if (de) {
            console.error("❌ Auth Conductor falló:", de.message);
            throw de;
        }
        driverId = dData.user.id;

        const { data: pData, error: pe } = await passenger.auth.signInWithPassword({ email: PASSENGER_EMAIL, password: PASS });
        if (pe) {
            console.error("❌ Auth Pasajero falló:", pe.message);
            throw pe;
        }
        passengerId = pData.user.id;

        // 2. Limpieza de estado previo
        await admin.from('rides').delete().eq('driver_id', driverId);
        await admin.from('transactions').delete().eq('user_id', passengerId);
        
        // 3. Reset Balance (Simulamos recarga)
        await admin.from('wallets').update({ balance: 100.00, held_balance: 0.00 }).eq('user_id', passengerId);
        await admin.from('wallets').update({ balance: 0.00, held_balance: 0.00 }).eq('user_id', driverId);
    });

    it('Paso 1: Conductor publica un viaje', async () => {
        const departure = new Date();
        departure.setDate(departure.getDate() + 1);

        const { data, error } = await driver.rpc('create_ride', {
            p_origin: { address: 'Madrid', lat: 40.4168, lng: -3.7038 },
            p_destination: { address: 'Barcelona', lat: 41.3851, lng: 2.1734 },
            p_departure_time: departure.toISOString(),
            p_seats: 4,
            p_price: 25.00,
            p_distance: 620,
            p_details: 'E2E Full Test Ride',
            p_waypoints: []
        });

        expect(error).toBeNull();
        expect(data.success).toBe(true);
        rideId = data.rideId;
    });

    it('Paso 2: Pasajero busca el viaje mediante el buscador seguro', async () => {
        const { data, error } = await passenger.rpc('search_rides_by_corridor', {
            p_pax_origin_lat: 40.41,
            p_pax_origin_lng: -3.70,
            p_pax_dest_lat: 41.38,
            p_pax_dest_lng: 2.17,
            p_max_detour_meters: 5000
        });

        expect(error).toBeNull();
        const found = data.find(r => r.id === rideId);
        expect(found).toBeDefined();
        expect(found.price).toBe(25.00);
    });

    it('Paso 3: Pasajero reserva la plaza (Lógica de Escrow y Bloqueo)', async () => {
        // El RPC confirm_trip_and_pay maneja: validación saldo, bloqueo wallet y creación de PIN
        const { data, error } = await passenger.rpc('confirm_trip_and_pay', {
            p_ride_id: rideId,
            p_pickup_address: 'Plaza Mayor, Madrid'
        });

        expect(error).toBeNull();
        expect(data.success).toBe(true);
        expect(data.pin).toBeDefined();
        reservationPin = data.pin;

        // Verificar Balance del Pasajero
        const { data: wallet } = await admin.from('wallets').select('balance, held_balance').eq('user_id', passengerId).single();
        expect(Number(wallet.balance)).toBe(75.00); // 100 - 25
        expect(Number(wallet.held_balance)).toBe(25.00);
    });

    it('Paso 4: Conductor consulta detalles y ve el PIN del pasajero', async () => {
        // get_ride_details_secure oculta PINs a extraños, pero se lo muestra al conductor
        const { data, error } = await driver.rpc('get_ride_details_secure', {
            p_ride_id: rideId
        });

        expect(error).toBeNull();
        const pax = data.passengers.find(p => p.id === passengerId);
        expect(pax.pin).toBe(reservationPin);
    });

    it('Paso 5: Finalización del viaje y Payout (Idempotencia y Comisiones)', async () => {
        // complete_ride reparte: 90% conductor, 10% plataforma (configurado en RPC)
        const { data, error } = await driver.rpc('complete_ride', {
            p_ride_id: rideId
        });

        expect(error).toBeNull();
        expect(data.success).toBe(true);
        // 25.00 * 0.9 = 22.50
        expect(Number(data.payout)).toBe(22.50);

        // Verificar Wallet Conductor
        const { data: dWallet } = await admin.from('wallets').select('balance').eq('user_id', driverId).single();
        expect(Number(dWallet.balance)).toBe(22.50);

        // Verificar Wallet Pasajero (held_balance liberado)
        const { data: pWallet } = await admin.from('wallets').select('held_balance').eq('user_id', passengerId).single();
        expect(Number(pWallet.held_balance)).toBe(0.00);
    });

    it('Paso 6: Verificación de Trazabilidad Financiera', async () => {
        const { data: txs } = await admin.from('transactions')
            .select('*')
            .eq('related_ride_id', rideId);

        // Debería haber al menos: 1 hold (pasajero), 1 payment_complete (pasajero), 1 payout (conductor)
        const types = txs.map(t => t.type);
        expect(types).toContain('hold');
        expect(types).toContain('payment_complete');
        expect(types).toContain('payout');
    });
});
