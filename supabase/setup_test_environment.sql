-- ==========================================
-- SHAREWAY V2: TEST ENVIRONMENT SETUP
-- Provisioning Auth users, Profiles, and Wallets for testing.
-- ==========================================
-- 1. CLEAN UP: Delete existing test users
-- cascade will handle profiles and wallets
DELETE FROM auth.users
WHERE email LIKE '%@test.com';
-- 2. CREATE TEST USERS (Auth Schema)
DO $$
DECLARE driver_id UUID := '00000000-0000-0000-0000-000000000001';
p1_id UUID := '00000000-0000-0000-0000-000000000002';
p2_id UUID := '00000000-0000-0000-0000-000000000003';
BEGIN -- Create Driver
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
        driver_id,
        '00000000-0000-0000-0000-000000000000',
        'authenticated',
        'authenticated',
        'driver@test.com',
        crypt('test1234', gen_salt('bf')),
        now(),
        '{"provider":"email"}',
        '{}'
    );
-- Create Passenger 1
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
        p1_id,
        '00000000-0000-0000-0000-000000000000',
        'authenticated',
        'authenticated',
        'p1@test.com',
        crypt('test1234', gen_salt('bf')),
        now(),
        '{"provider":"email"}',
        '{}'
    );
-- Create Passenger 2
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
        p2_id,
        '00000000-0000-0000-0000-000000000000',
        'authenticated',
        'authenticated',
        'p2@test.com',
        crypt('test1234', gen_salt('bf')),
        now(),
        '{"provider":"email"}',
        '{}'
    );
-- Note: handle_new_user trigger will automatically create rows in public.profiles and public.wallets
END $$;
-- 3. ENHANCE TEST PROFILES & WALLETS
-- Update verification status
UPDATE public.profiles
SET verification = jsonb_build_object('status', 'verified'),
    full_name = CASE
        WHEN id = '00000000-0000-0000-0000-000000000001' THEN 'Driver Elite'
        WHEN id = '00000000-0000-0000-0000-000000000002' THEN 'Passenger 1'
        ELSE 'Passenger 2'
    END
WHERE email LIKE '%@test.com';
-- Set robust balances for passengers
UPDATE public.wallets
SET balance = 1000.00
WHERE user_id IN (
        '00000000-0000-0000-0000-000000000002',
        '00000000-0000-0000-0000-000000000003'
    );