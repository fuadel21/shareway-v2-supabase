/**
 * Helpers para testing de Shareway
 * Datos realistas pero controlados, limpieza automática
 */

import { createClient } from '@supabase/supabase-js';

const uuidv4 = () => crypto.randomUUID();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

// FIX: Cambiamos a 'public' porque 'test_shareway' no está expuesto en la API de Supabase
export const testClient = createClient(
    supabaseUrl || 'https://mock.supabase.co', 
    supabaseServiceKey || 'mock-key', 
    { db: { schema: 'public' } } 
);

export const withTestSchema = async (fn) => {
    const { data: { user } } = await testClient.auth.getUser();
    if (!user) {
        const { data, error } = await testClient.auth.signUp({
            email: `test-${uuidv4()}@example.com`,
            password: 'testpassword123'
        });
        if (error) throw error;
        await testClient.auth.setSession(data.session);
    }
    
    return await fn();
};

export const testData = {
    locations: {
        sol: { name: 'Puerta del Sol', address: 'Puerta del Sol, Madrid', coordinates: { lat: 40.4168, lng: -3.7038 } },
        plazaMayor: { name: 'Plaza Mayor', address: 'Plaza Mayor, Madrid', coordinates: { lat: 40.4155, lng: -3.7074 } }
    },
    profiles: {
        driverVerified: { id: uuidv4(), email: 'driver-verified@test.com', display_name: 'Conductor Verificado', gender: 'male', verification: { status: 'verified' } }
    }
};

export const createTestProfile = async (profileData) => {
    const { data, error } = await testClient.from('profiles').insert(profileData).select().single();
    if (error) throw error;
    return data;
};

export const cleanupTestData = async () => {
    // IMPORTANTE: Esta RPC debe existir en tu DB para borrar datos de TEST sin tocar producción
    // O usar filtros por email 'test-%'
    try {
        await testClient.rpc('cleanup_all_test_data');
    } catch (e) {
        console.warn("Cleanup RPC failed, tests might be flaky");
    }
};
