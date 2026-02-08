-- ========================================================
-- TEST SCHEMA FOR SHAREWAY TESTING
-- Aislado de producción, mismo estructura, datos controlados
-- ========================================================

-- 1. Crear schema de testing si no existe
CREATE SCHEMA IF NOT EXISTS test_shareway;

-- 2. Tablas de testing (misma estructura que producción)
-- Solo se incluyen tablas críticas para mantener el schema ligero

-- Profiles (simplificado para testing)
CREATE TABLE IF NOT EXISTS test_shareway.profiles (
    id UUID PRIMARY KEY,
    email TEXT UNIQUE,
    display_name TEXT,
    photo_url TEXT,
    gender TEXT DEFAULT 'unspecified',
    verification JSONB DEFAULT '{"status": "verified"}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Rides
CREATE TABLE IF NOT EXISTS test_shareway.rides (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    driver_id UUID REFERENCES test_shareway.profiles(id) ON DELETE CASCADE,
    driver_display_name TEXT,
    driver_photo_url TEXT,
    origin JSONB NOT NULL,
    destination JSONB NOT NULL,
    origin_location GEOGRAPHY(POINT, 4326),
    destination_location GEOGRAPHY(POINT, 4326),
    departure_time TIMESTAMPTZ NOT NULL,
    seats_total INTEGER NOT NULL CHECK (seats_total > 0),
    seats_available INTEGER NOT NULL,
    price NUMERIC(10, 2) DEFAULT 0.00,
    details TEXT,
    distance NUMERIC,
    overview_polyline TEXT,
    bounds JSONB,
    status TEXT DEFAULT 'scheduled' CHECK (
        status IN ('scheduled', 'active', 'in_progress', 'completed', 'cancelled', 'expired')
    ),
    is_women_only BOOLEAN DEFAULT FALSE,
    is_exclusive_community BOOLEAN DEFAULT FALSE,
    allowed_communities TEXT [] DEFAULT '{}',
    approval_mode TEXT DEFAULT 'automatic' CHECK (approval_mode IN ('automatic', 'manual')),
    waypoints JSONB DEFAULT '[]'::jsonb,
    preferences JSONB DEFAULT '{}'::jsonb,
    participant_ids UUID [] DEFAULT '{}',
    passengers JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ride Requests
CREATE TABLE IF NOT EXISTS test_shareway.ride_requests (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    requester_id UUID REFERENCES test_shareway.profiles(id) ON DELETE CASCADE,
    requester_display_name TEXT,
    requester_photo_url TEXT,
    origin JSONB,
    destination JSONB,
    origin_location GEOGRAPHY(POINT, 4326),
    destination_location GEOGRAPHY(POINT, 4326),
    departure_time TIMESTAMPTZ,
    seats_needed INTEGER DEFAULT 1,
    suggested_price NUMERIC,
    status TEXT DEFAULT 'pending' CHECK (
        status IN ('pending', 'accepted', 'confirmed', 'rejected', 'cancelled', 'expired', 'fulfilled')
    ),
    note TEXT,
    is_women_only BOOLEAN DEFAULT FALSE,
    distance NUMERIC,
    overview_polyline TEXT,
    matched_ride_id UUID REFERENCES test_shareway.rides(id) ON DELETE SET NULL,
    payment_expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Wallets
CREATE TABLE IF NOT EXISTS test_shareway.wallets (
    user_id UUID REFERENCES test_shareway.profiles(id) ON DELETE CASCADE PRIMARY KEY,
    balance NUMERIC(10, 2) DEFAULT 100.00,  -- Saldo inicial para tests
    held_balance NUMERIC(10, 2) DEFAULT 0.00,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Transactions
CREATE TABLE IF NOT EXISTS test_shareway.transactions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES test_shareway.profiles(id) ON DELETE CASCADE,
    amount NUMERIC(10, 2) NOT NULL,
    balance_after NUMERIC(10, 2),
    type TEXT,
    description TEXT,
    related_ride_id UUID,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. RPCs de testing (mismas que producción pero apuntando a test_shareway)
-- Se crearán en los archivos de test usando `set_config('search_path', 'test_shareway')`

-- 4. Funciones de utilidad para tests
CREATE OR REPLACE FUNCTION test_shareway.cleanup_all_data() RETURNS void AS $$
BEGIN
    DELETE FROM test_shareway.transactions;
    DELETE FROM test_shareway.wallets;
    DELETE FROM test_shareway.ride_requests;
    DELETE FROM test_shareway.rides;
    DELETE FROM test_shareway.profiles;
END;
$$ LANGUAGE plpgsql;

-- 5. Datos de prueba (creados por helpers en JS, no aquí para mantener tests deterministas)

-- 6. Índices para performance en tests
CREATE INDEX IF NOT EXISTS idx_test_rides_driver_status ON test_shareway.rides(driver_id, status);
CREATE INDEX IF NOT EXISTS idx_test_requests_requester_status ON test_shareway.ride_requests(requester_id, status);
CREATE INDEX IF NOT EXISTS idx_test_rides_departure_time ON test_shareway.rides(departure_time);

-- 7. Permisos (en tests, usaremos el mismo role de auth)
GRANT ALL ON SCHEMA test_shareway TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA test_shareway TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA test_shareway TO authenticated;

-- Comentarios para auditoría
COMMENT ON SCHEMA test_shareway IS 'Schema aislado para tests automatizados de Shareway';
COMMENT ON FUNCTION test_shareway.cleanup_all_data() IS 'Limpia todas las tablas de testing entre tests';
