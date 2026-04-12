-- FUNCIÓN PARA OBTENER LOS CHATS DE UN VIAJE ESPECÍFICO
-- Utilizada en RideChatSelector.jsx para listar conversaciones
CREATE OR REPLACE FUNCTION public.get_ride_chats(p_ride_id UUID) RETURNS TABLE (
        chat_id UUID,
        chat_type TEXT,
        participants UUID [],
        participant_names JSONB,
        last_message JSONB,
        unread_count INTEGER,
        ride_id UUID
    ) AS $$ BEGIN RETURN QUERY
SELECT c.id as chat_id,
    c.type as chat_type,
    c.participants,
    (
        SELECT jsonb_object_agg(p.id, p.display_name)
        FROM public.profiles p
        WHERE p.id = ANY(c.participants)
    ) as participant_names,
    (
        SELECT json_build_object(
                'content',
                m.content,
                'created_at',
                m.created_at,
                'sender_id',
                m.sender_id
            )::JSONB
        FROM public.messages m
        WHERE m.chat_id = c.id
        ORDER BY m.created_at DESC
        LIMIT 1
    ) as last_message,
    (
        SELECT COUNT(*)::INTEGER
        FROM public.messages m
        WHERE m.chat_id = c.id
            AND m.sender_id != auth.uid()
            AND (
                m.read_by IS NULL
                OR NOT (m.read_by @> jsonb_build_array(auth.uid()))
            )
    ) as unread_count,
    c.ride_id
FROM public.chats c
WHERE c.ride_id = p_ride_id
    AND auth.uid() = ANY(c.participants);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
-- SISTEMA DE ERROR LOGGING PARA EL FRONTEND
CREATE OR REPLACE FUNCTION public.log_error(
        p_error_message TEXT,
        p_error_stack TEXT DEFAULT NULL,
        p_user_id UUID DEFAULT NULL,
        p_context JSONB DEFAULT '{}'::jsonb
    ) RETURNS VOID AS $$ BEGIN
INSERT INTO public.rpc_error_logs (
        function_name,
        error_message,
        error_detail,
        user_id,
        params
    )
VALUES (
        'frontend_client',
        p_error_message,
        p_error_stack,
        p_user_id,
        p_context
    );
END;
$$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER;
-- PERFORMANCE LOGGING
CREATE OR REPLACE FUNCTION public.log_query_performance(
        p_query_name TEXT,
        p_execution_time_ms FLOAT,
        p_user_id UUID DEFAULT NULL
    ) RETURNS VOID AS $$ BEGIN -- Por ahora solo un placeholder
    NULL;
END;
$$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER;
-- FUNCIÓN PARA MARCAR TODAS LAS NOTIFICACIONES COMO LEÍDAS
CREATE OR REPLACE FUNCTION public.mark_all_notifications_read() RETURNS VOID AS $$ BEGIN
UPDATE public.notifications
SET is_read = TRUE
WHERE user_id = auth.uid()
    AND is_read = FALSE;
END;
$$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER;
-- FUNCIÓN PARA OBTENER ESTADÍSTICAS DEL DASHBOARD
CREATE OR REPLACE FUNCTION public.get_dashboard_stats() RETURNS JSON AS $$
DECLARE v_user_id UUID := auth.uid();
v_wallet_balance DECIMAL;
v_rides_count INTEGER;
v_unread_notifications INTEGER;
v_active_rides_count INTEGER;
BEGIN
SELECT balance INTO v_wallet_balance
FROM public.wallets
WHERE user_id = v_user_id;
SELECT COUNT(*) INTO v_rides_count
FROM public.rides
WHERE driver_id = v_user_id
    OR v_user_id = ANY(participant_ids);
SELECT COUNT(*) INTO v_unread_notifications
FROM public.notifications
WHERE user_id = v_user_id
    AND is_read = FALSE;
SELECT COUNT(*) INTO v_active_rides_count
FROM public.rides
WHERE status = 'active'
    AND (
        driver_id = v_user_id
        OR v_user_id = ANY(participant_ids)
    );
RETURN json_build_object(
    'balance',
    COALESCE(v_wallet_balance, 0),
    'totalRides',
    v_rides_count,
    'unreadNotifications',
    v_unread_notifications,
    'activeRides',
    v_active_rides_count
);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;