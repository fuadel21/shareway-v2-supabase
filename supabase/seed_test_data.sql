-- ==========================================
-- SHAREWAY V2: UNIVERSAL MASTER SEED
-- Clean, Auth Provisioning, and App Data
-- ==========================================
-- 1. NUCLEAR CLEAN (Auth Context)
-- This cascades and cleans everything via foreign keys
DELETE FROM auth.users
WHERE email LIKE '%@test.com';
-- 2. RESET APP TABLES (Just in case)
TRUNCATE TABLE public.communities,
public.rides,
public.ride_requests,
public.favorite_routes,
public.emergency_contacts,
public.transactions,
public.chats,
public.messages,
public.reviews,
public.notifications,
public.user_achievements,
public.payout_requests,
public.cancellation_disputes,
public.packages RESTART IDENTITY CASCADE;
-- 3. PROVISION AUTH USERS
INSERT INTO auth.users (
        id,
        instance_id,
        aud,
        role,
        email,
        encrypted_password,
        email_confirmed_at,
        raw_app_meta_data,
        raw_user_meta_data
    )
VALUES (
        '00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000000',
        'authenticated',
        'authenticated',
        'driver@test.com',
        crypt('test1234', gen_salt('bf')),
        now(),
        '{"provider":"email"}',
        '{}'
    ),
    (
        '00000000-0000-0000-0000-000000000002',
        '00000000-0000-0000-0000-000000000000',
        'authenticated',
        'authenticated',
        'p1@test.com',
        crypt('test1234', gen_salt('bf')),
        now(),
        '{"provider":"email"}',
        '{}'
    ),
    (
        '00000000-0000-0000-0000-000000000003',
        '00000000-0000-0000-0000-000000000000',
        'authenticated',
        'authenticated',
        'p2@test.com',
        crypt('test1234', gen_salt('bf')),
        now(),
        '{"provider":"email"}',
        '{}'
    );
-- 4. UPDATE PROFILES (Trigger handled insertion, we update details)
-- We use UPSERT/UPDATE because the handle_new_user trigger already fired
UPDATE public.profiles
SET display_name = CASE
        WHEN id = '00000000-0000-0000-0000-000000000001' THEN 'Test Driver'
        WHEN id = '00000000-0000-0000-0000-000000000002' THEN 'Test Passenger 1'
        ELSE 'Test Passenger 2'
    END,
    verification = '{"status": "verified"}'::jsonb,
    eco_tier = 'Forest'
WHERE email LIKE '%@test.com';
-- 5. SET BALANCES
UPDATE public.wallets
SET balance = 500
WHERE user_id IN (
        '00000000-0000-0000-0000-000000000002',
        '00000000-0000-0000-0000-000000000003'
    );
UPDATE public.wallets
SET balance = 100
WHERE user_id = '00000000-0000-0000-0000-000000000001';
-- 6. RE-SEED LOGROS
INSERT INTO public.achievements (id, name, description, icon)
VALUES (
        'FIRST_RIDE',
        'Pionero del Asfalto',
        'Completa tu primer viaje como conductor o pasajero.',
        'award'
    ),
    (
        'CO2_SAVER_1',
        'Héroe del Carbono',
        'Ahorra 10kg de CO2.',
        'leaf'
    ),
    (
        'CO2_SAVER_2',
        'Guardián del Planeta',
        'Ahorra 50kg de CO2.',
        'shield'
    ),
    (
        'FIVE_STAR_DRIVER',
        'Conductor 5 Estrellas',
        'Recibe tu primera calificación de 5 estrellas.',
        'star'
    ),
    (
        'GREEN_WASH',
        'Lavado Verde',
        'Completa 10 viajes compartidos.',
        'umbrella'
    ) ON CONFLICT DO NOTHING;
-- 7. VIAJE DE REFERENCIA PARA TESTS DE SOLAPAMIENTO
-- Mañana a las 12:00
INSERT INTO public.rides (
        driver_id,
        driver_display_name,
        origin,
        destination,
        departure_time,
        seats_total,
        seats_available,
        price,
        status,
        origin_location,
        destination_location
    )
VALUES (
        '00000000-0000-0000-0000-000000000001',
        'Test Driver',
        '{"address": "Madrid", "lat": 40.41, "lng": -3.70}'::jsonb,
        '{"address": "Barcelona", "lat": 41.38, "lng": 2.17}'::jsonb,
        (CURRENT_DATE + 1 + TIME '12:00:00')::timestamp with time zone,
        4,
        4,
        30.00,
        'scheduled',
        ST_SetSRID(ST_MakePoint(-3.70, 40.41), 4326)::geography,
        ST_SetSRID(ST_MakePoint(2.17, 41.38), 4326)::geography
    );