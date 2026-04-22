-- ==============================================================================
-- LIQUIDACIÓN 2.0 Y MOTOR DE ANALÍTICAS ELITE
-- ==============================================================================

-- 1. REFACTOR: complete_ride con Liquidación Selectiva (Solo Verificados)
CREATE OR REPLACE FUNCTION public.complete_ride_v3(p_ride_id UUID)
RETURNS JSON AS $$
DECLARE
    v_driver_id UUID := auth.uid();
    v_ride_record RECORD;
    v_passenger JSONB;
    v_gross_amount DECIMAL := 0;
    v_verified_count INTEGER := 0;
    v_platform_fee_percent DECIMAL := 0.10; -- 10%
    v_net_payout DECIMAL := 0;
    v_passenger_id UUID;
    v_booked_price DECIMAL;
BEGIN
    -- Bloqueo de seguridad
    SELECT * INTO v_ride_record FROM public.rides WHERE id = p_ride_id FOR UPDATE;

    IF v_ride_record.driver_id != v_driver_id THEN RAISE EXCEPTION 'NO_AUTORIZADO'; END IF;
    IF v_ride_record.status = 'completed' THEN RETURN jsonb_build_object('success', true, 'note', 'already_completed'); END IF;

    -- PROCESAR PAGOS SOLO DE PASAJEROS QUE REALMENTE SUBIERON (PIN VALIDADO)
    FOR v_passenger IN SELECT * FROM jsonb_array_elements(v_ride_record.passengers) LOOP
        v_passenger_id := (v_passenger->>'id')::UUID;
        v_booked_price := (v_passenger->>'booked_price')::DECIMAL;

        IF v_passenger->>'status' = 'verified' THEN
            v_gross_amount := v_gross_amount + v_booked_price;
            v_verified_count := v_verified_count + 1;

            -- Liberar el held_balance (ya que se mueve a balance del conductor)
            UPDATE public.wallets SET held_balance = GREATEST(0, held_balance - v_booked_price)
            WHERE user_id = v_passenger_id;
        ELSIF v_passenger->>'status' = 'confirmed' THEN
            -- No-show: Dinero se queda en held_balance para revisión de soporte o reembolso
            -- No se suma al pago del conductor por ahora (Evita fraude)
        END IF;
    END LOOP;

    -- Liquidación al Conductor
    v_net_payout := v_gross_amount * (1 - v_platform_fee_percent);

    IF v_net_payout > 0 THEN
        UPDATE public.wallets SET balance = balance + v_net_payout WHERE user_id = v_driver_id;

        INSERT INTO public.transactions (user_id, amount, type, description, related_ride_id)
        VALUES (v_driver_id, v_net_payout, 'payout', 'Liquidación de viaje: ' || v_verified_count || ' pasajeros verificados.', p_ride_id);
    END IF;

    -- Cerrar Viaje y Activar Trigger de Impacto Eco (que ya existe)
    UPDATE public.rides SET
        status = 'completed',
        completed_at = NOW(),
        updated_at = NOW()
    WHERE id = p_ride_id;

    RETURN jsonb_build_object(
        'success', true,
        'passengers_verified', v_verified_count,
        'payout', v_net_payout,
        'commission', (v_gross_amount * v_platform_fee_percent)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. VISTA DE ANALÍTICAS: Platform Health Dashboard (Versión Corregida v3.2)
-- Aseguramos que la columna status existe en emergency_alerts para evitar errores
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='emergency_alerts' AND column_name='status') THEN
        ALTER TABLE public.emergency_alerts ADD COLUMN status TEXT DEFAULT 'active';
    END IF;
END $$;

DROP VIEW IF EXISTS public.admin_analytics_summary CASCADE;
CREATE OR REPLACE VIEW public.admin_analytics_summary AS
WITH ride_metrics AS (
    SELECT
        COUNT(*) as total_rides,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_rides,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled_rides,
        COALESCE(SUM(distance), 0) as total_km_shared
    FROM public.rides
),
financial_metrics AS (
    SELECT COALESCE(SUM(amount), 0) as total_payouts
    FROM public.transactions
    WHERE type = 'payout'
),
user_metrics AS (
    SELECT COUNT(*) as total_users FROM public.profiles
),
safety_metrics AS (
    SELECT COUNT(*) as active_sos_alerts
    FROM public.emergency_alerts
    WHERE status = 'active'
)
SELECT
    rm.total_rides,
    rm.completed_rides,
    rm.cancelled_rides,
    (fm.total_payouts / 0.9 * 0.1) as estimated_platform_revenue,
    um.total_users,
    sm.active_sos_alerts,
    rm.total_km_shared,
    (rm.total_km_shared * 0.1) as total_co2_saved_kg -- Estimación 100g/km
FROM ride_metrics rm, financial_metrics fm, user_metrics um, safety_metrics sm;

-- 3. RPC: get_admin_dashboard_stats
CREATE OR REPLACE FUNCTION public.get_admin_dashboard_stats()
RETURNS JSON AS $$
DECLARE
    v_stats RECORD;
BEGIN
    -- Solo admins pueden llamar a esto (asumiendo que tienes una columna is_admin)
    IF NOT (SELECT (verification->>'is_admin')::BOOLEAN FROM public.profiles WHERE id = auth.uid()) THEN
        RAISE EXCEPTION 'ACCESO_DENEGADO';
    END IF;

    SELECT * INTO v_stats FROM public.admin_analytics_summary;

    RETURN jsonb_build_object(
        'kpis', jsonb_build_object(
            'total_rides', v_stats.total_rides,
            'success_rate', (v_stats.completed_rides::FLOAT / NULLIF(v_stats.total_rides, 0)) * 100,
            'revenue', v_stats.estimated_platform_revenue,
            'total_users', v_stats.total_users,
            'active_alerts', v_stats.active_sos_alerts
        ),
        'impact', jsonb_build_object(
            'km_shared', v_stats.total_km_shared,
            'co2_saved', v_stats.total_co2_saved_kg
        )
    );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
