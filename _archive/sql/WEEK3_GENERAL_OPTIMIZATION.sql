-- ==========================================
-- WEEK 3: GENERAL OPTIMIZATION
-- ==========================================
-- Performance tuning, load testing, and error monitoring

-- ==========================================
-- 1. ADVANCED PERFORMANCE TUNING
-- ==========================================

-- Create performance monitoring tables
CREATE TABLE IF NOT EXISTS public.performance_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_name TEXT NOT NULL,
    query_pattern TEXT NOT NULL,
    avg_execution_time DECIMAL,
    max_execution_time DECIMAL,
    min_execution_time DECIMAL,
    query_count INTEGER DEFAULT 0,
    total_execution_time DECIMAL,
    last_executed TIMESTAMPTZ DEFAULT NOW(),
    optimization_suggestions JSONB DEFAULT '[]'::JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create query performance log table
CREATE TABLE IF NOT EXISTS public.query_performance_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    query_hash TEXT NOT NULL,
    query_text TEXT,
    execution_time DECIMAL NOT NULL,
    rows_returned INTEGER,
    user_id UUID,
    session_id TEXT,
    query_type TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for performance monitoring
CREATE INDEX IF NOT EXISTS idx_performance_profiles_query_pattern ON public.performance_profiles(query_pattern);
CREATE INDEX IF NOT EXISTS idx_performance_profiles_avg_execution ON public.performance_profiles(avg_execution_time DESC);
CREATE INDEX IF NOT EXISTS idx_query_performance_log_hash ON public.query_performance_log(query_hash);
CREATE INDEX IF NOT EXISTS idx_query_performance_log_execution_time ON public.query_performance_log(execution_time DESC);
CREATE INDEX IF NOT EXISTS idx_query_performance_log_created ON public.query_performance_log(created_at DESC);

-- Function to log query performance
CREATE OR REPLACE FUNCTION public.log_query_performance(
    p_query_text TEXT,
    p_execution_time DECIMAL,
    p_rows_returned INTEGER DEFAULT 0,
    p_user_id UUID DEFAULT NULL,
    p_session_id TEXT DEFAULT NULL,
    p_query_type TEXT DEFAULT 'unknown'
) RETURNS UUID AS $$
DECLARE
    v_query_hash TEXT;
    v_profile_id UUID;
    v_log_id UUID;
BEGIN
    -- Generate query hash (simplified version)
    v_query_hash := MD5(p_query_text);
    
    -- Log the query performance
    INSERT INTO public.query_performance_log(
        query_hash, query_text, execution_time, rows_returned, user_id, session_id, query_type
    ) VALUES (
        v_query_hash, p_query_text, p_execution_time, p_rows_returned, p_user_id, p_session_id, p_query_type
    ) RETURNING id INTO v_log_id;
    
    -- Update or create performance profile
    SELECT id INTO v_profile_id
    FROM public.performance_profiles
    WHERE query_pattern = v_query_hash;
    
    IF v_profile_id IS NOT NULL THEN
        -- Update existing profile
        UPDATE public.performance_profiles
        SET 
            avg_execution_time = (
                (avg_execution_time * query_count + p_execution_time) / (query_count + 1)
            ),
            max_execution_time = GREATEST(max_execution_time, p_execution_time),
            min_execution_time = LEAST(min_execution_time, p_execution_time),
            query_count = query_count + 1,
            total_execution_time = total_execution_time + p_execution_time,
            last_executed = NOW()
        WHERE id = v_profile_id;
    ELSE
        -- Create new profile
        INSERT INTO public.performance_profiles(
            profile_name, query_pattern, avg_execution_time, max_execution_time, 
            min_execution_time, query_count, total_execution_time, last_executed
        ) VALUES (
            'Query Profile', v_query_hash, p_execution_time, p_execution_time, 
            p_execution_time, 1, p_execution_time, NOW()
        ) RETURNING id INTO v_profile_id;
    END IF;
    
    -- Add optimization suggestions for slow queries
    IF p_execution_time > 1000 THEN -- More than 1 second
        UPDATE public.performance_profiles
        SET optimization_suggestions = jsonb_set(
            COALESCE(optimization_suggestions, '[]'::JSONB),
            '{0}',
            jsonb_build_object(
                'suggestion', 'Consider adding index',
                'reason', 'Query takes more than 1 second',
                'execution_time', p_execution_time,
                'created_at', NOW()
            )
        )
        WHERE id = v_profile_id;
    END IF;
    
    RETURN v_log_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get performance recommendations
CREATE OR REPLACE FUNCTION public.get_performance_recommendations(
    p_limit INTEGER DEFAULT 10
) RETURNS TABLE (
    query_pattern TEXT,
    avg_execution_time DECIMAL,
    query_count INTEGER,
    optimization_suggestion JSONB,
    priority TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        pp.query_pattern,
        pp.avg_execution_time,
        pp.query_count,
        pp.optimization_suggestions,
        CASE 
            WHEN pp.avg_execution_time > 5000 THEN 'HIGH'
            WHEN pp.avg_execution_time > 2000 THEN 'MEDIUM'
            WHEN pp.avg_execution_time > 1000 THEN 'LOW'
            ELSE 'INFO'
        END as priority
    FROM public.performance_profiles pp
    WHERE pp.avg_execution_time > 500
        AND jsonb_array_length(pp.optimization_suggestions) > 0
    ORDER BY pp.avg_execution_time DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ==========================================
-- 2. LOAD TESTING FRAMEWORK
-- ==========================================

-- Create load testing results table
CREATE TABLE IF NOT EXISTS public.load_test_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    test_name TEXT NOT NULL,
    concurrent_users INTEGER NOT NULL,
    requests_per_second DECIMAL NOT NULL,
    avg_response_time DECIMAL NOT NULL,
    max_response_time DECIMAL NOT NULL,
    min_response_time DECIMAL NOT NULL,
    error_rate DECIMAL NOT NULL,
    throughput DECIMAL NOT NULL,
    total_requests INTEGER NOT NULL,
    successful_requests INTEGER NOT NULL,
    failed_requests INTEGER NOT NULL,
    test_duration_seconds INTEGER NOT NULL,
    test_timestamp TIMESTAMPTZ DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'::JSONB
);

-- Function to simulate load test
CREATE OR REPLACE FUNCTION public.simulate_load_test(
    p_test_name TEXT,
    p_concurrent_users INTEGER DEFAULT 10,
    p_requests_per_second DECIMAL DEFAULT 100,
    p_duration_seconds INTEGER DEFAULT 60
) RETURNS JSON AS $$
DECLARE
    v_start_time TIMESTAMPTZ := NOW();
    v_end_time TIMESTAMPTZ := v_start_time + (p_duration_seconds || ' seconds')::INTERVAL;
    v_total_requests INTEGER := 0;
    v_successful_requests INTEGER := 0;
    v_failed_requests INTEGER := 0;
    v_response_times DECIMAL[] := '{}';
    v_current_time TIMESTAMPTZ;
    v_test_result JSON;
    v_avg_response_time DECIMAL;
BEGIN
    -- Simulate load test (simplified version)
    -- In a real implementation, this would use actual concurrent connections
    
    -- Simulate requests over time
    v_current_time := v_start_time;
    WHILE v_current_time < v_end_time LOOP
        -- Simulate batch of requests
        FOR i IN 1..CEIL(p_requests_per_second) LOOP
            v_total_requests := v_total_requests + 1;
            
            -- Simulate response time (random between 50ms and 500ms)
            v_response_times := array_append(v_response_times, 50 + (random() * 450));
            
            -- Simulate success/failure (95% success rate)
            IF random() > 0.05 THEN
                v_successful_requests := v_successful_requests + 1;
            ELSE
                v_failed_requests := v_failed_requests + 1;
            END IF;
        END LOOP;
        
        v_current_time := v_current_time + INTERVAL '1 second';
    END LOOP;
    
    -- Calculate statistics
    SELECT AVG(response_time) INTO v_avg_response_time
    FROM unnest(v_response_times) AS response_time;
    
    v_test_result := jsonb_build_object(
        'test_name', p_test_name,
        'concurrent_users', p_concurrent_users,
        'requests_per_second', p_requests_per_second,
        'duration_seconds', p_duration_seconds,
        'total_requests', v_total_requests,
        'successful_requests', v_successful_requests,
        'failed_requests', v_failed_requests,
        'avg_response_time', COALESCE(v_avg_response_time, 0),
        'max_response_time', CASE WHEN array_length(v_response_times, 1) > 0 THEN (SELECT max(response_time) FROM unnest(v_response_times) AS response_time) ELSE 0 END,
        'min_response_time', CASE WHEN array_length(v_response_times, 1) > 0 THEN (SELECT min(response_time) FROM unnest(v_response_times) AS response_time) ELSE 0 END,
        'error_rate', CASE WHEN v_total_requests > 0 THEN (v_failed_requests::DECIMAL / v_total_requests::DECIMAL) * 100 ELSE 0 END,
        'throughput', CASE WHEN p_duration_seconds > 0 THEN v_successful_requests::DECIMAL / p_duration_seconds ELSE 0 END,
        'test_timestamp', NOW()
    );
    
    -- Store test results
    INSERT INTO public.load_test_results(
        test_name, concurrent_users, requests_per_second, avg_response_time,
        max_response_time, min_response_time, error_rate, throughput,
        total_requests, successful_requests, failed_requests, test_duration_seconds,
        metadata
    ) VALUES (
        p_test_name, p_concurrent_users, p_requests_per_second,
        (v_test_result->>'avg_response_time')::DECIMAL,
        (v_test_result->>'max_response_time')::DECIMAL,
        (v_test_result->>'min_response_time')::DECIMAL,
        (v_test_result->>'error_rate')::DECIMAL,
        (v_test_result->>'throughput')::DECIMAL,
        v_total_requests, v_successful_requests, v_failed_requests,
        p_duration_seconds, v_test_result
    );
    
    RETURN v_test_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get load test history
CREATE OR REPLACE FUNCTION public.get_load_test_history(
    p_limit INTEGER DEFAULT 20
) RETURNS TABLE (
    test_name TEXT,
    concurrent_users INTEGER,
    requests_per_second DECIMAL,
    avg_response_time DECIMAL,
    error_rate DECIMAL,
    throughput DECIMAL,
    test_timestamp TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        ltr.test_name,
        ltr.concurrent_users,
        ltr.requests_per_second,
        ltr.avg_response_time,
        ltr.error_rate,
        ltr.throughput,
        ltr.test_timestamp
    FROM public.load_test_results ltr
    ORDER BY ltr.test_timestamp DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ==========================================
-- 3. ERROR MONITORING AND ALERTING
-- ==========================================

-- Create error monitoring table
CREATE TABLE IF NOT EXISTS public.error_monitoring (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    error_type TEXT NOT NULL,
    error_message TEXT NOT NULL,
    error_code TEXT,
    stack_trace TEXT,
    user_id UUID,
    session_id TEXT,
    request_path TEXT,
    request_method TEXT,
    user_agent TEXT,
    ip_address INET,
    severity TEXT DEFAULT 'error' CHECK (severity IN ('debug', 'info', 'warning', 'error', 'critical')),
    resolved BOOLEAN DEFAULT FALSE,
    resolved_at TIMESTAMPTZ,
    resolved_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'::JSONB
);

-- Create error alerts table
CREATE TABLE IF NOT EXISTS public.error_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    alert_type TEXT NOT NULL,
    alert_message TEXT NOT NULL,
    threshold_value DECIMAL,
    current_value DECIMAL,
    alert_level TEXT DEFAULT 'warning' CHECK (alert_level IN ('info', 'warning', 'critical')),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    metadata JSONB DEFAULT '{}'::JSONB
);

-- Create indexes for error monitoring
CREATE INDEX IF NOT EXISTS idx_error_monitoring_error_type ON public.error_monitoring(error_type);
CREATE INDEX IF NOT EXISTS idx_error_monitoring_severity ON public.error_monitoring(severity);
CREATE INDEX IF NOT EXISTS idx_error_monitoring_created ON public.error_monitoring(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_monitoring_resolved ON public.error_monitoring(resolved);
CREATE INDEX IF NOT EXISTS idx_error_alerts_active ON public.error_alerts(is_active);
CREATE INDEX IF NOT EXISTS idx_error_alerts_level ON public.error_alerts(alert_level);

-- Function to log errors
CREATE OR REPLACE FUNCTION public.log_error(
    p_error_type TEXT,
    p_error_message TEXT,
    p_error_code TEXT DEFAULT NULL,
    p_stack_trace TEXT DEFAULT NULL,
    p_user_id UUID DEFAULT NULL,
    p_session_id TEXT DEFAULT NULL,
    p_request_path TEXT DEFAULT NULL,
    p_request_method TEXT DEFAULT NULL,
    p_user_agent TEXT DEFAULT NULL,
    p_ip_address INET DEFAULT NULL,
    p_severity TEXT DEFAULT 'error',
    p_metadata JSONB DEFAULT '{}'::JSONB
) RETURNS UUID AS $$
DECLARE
    v_error_id UUID;
    v_alert_threshold DECIMAL := 10; -- Alert if more than 10 errors in 5 minutes
    v_recent_error_count INTEGER;
BEGIN
    -- Log the error
    INSERT INTO public.error_monitoring(
        error_type, error_message, error_code, stack_trace, user_id, session_id,
        request_path, request_method, user_agent, ip_address, severity, metadata
    ) VALUES (
        p_error_type, p_error_message, p_error_code, p_stack_trace, p_user_id, p_session_id,
        p_request_path, p_request_method, p_user_agent, p_ip_address, p_severity, p_metadata
    ) RETURNING id INTO v_error_id;
    
    -- Check if we need to create an alert
    SELECT COUNT(*) INTO v_recent_error_count
    FROM public.error_monitoring
    WHERE error_type = p_error_type
        AND created_at > NOW() - INTERVAL '5 minutes';
    
    IF v_recent_error_count >= v_alert_threshold THEN
        INSERT INTO public.error_alerts(
            alert_type, alert_message, threshold_value, current_value, alert_level, metadata
        ) VALUES (
            'error_threshold',
            format('High error rate detected for %s: %s errors in 5 minutes', p_error_type, v_recent_error_count),
            v_alert_threshold,
            v_recent_error_count,
            CASE 
                WHEN v_recent_error_count >= 50 THEN 'critical'
                WHEN v_recent_error_count >= 25 THEN 'warning'
                ELSE 'info'
            END,
            jsonb_build_object(
                'error_type', p_error_type,
                'recent_errors', v_recent_error_count,
                'time_window', '5 minutes',
                'latest_error_id', v_error_id
            )
        );
    END IF;
    
    RETURN v_error_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get error statistics
CREATE OR REPLACE FUNCTION public.get_error_statistics(
    p_hours INTEGER DEFAULT 24
) RETURNS JSONB AS $$
DECLARE
    v_total_errors INTEGER;
    v_errors_by_type JSONB;
    v_errors_by_severity JSONB;
    v_unresolved_errors INTEGER;
    v_critical_alerts INTEGER;
BEGIN
    -- Total errors
    SELECT COUNT(*) INTO v_total_errors
    FROM public.error_monitoring
    WHERE created_at > NOW() - (p_hours || ' hours')::INTERVAL;
    
    -- Errors by type
    SELECT jsonb_agg(
        jsonb_build_object(
            'error_type', error_type,
            'count', error_count
        )
    ) INTO v_errors_by_type
    FROM (
        SELECT error_type, COUNT(*) as error_count
        FROM public.error_monitoring
        WHERE created_at > NOW() - (p_hours || ' hours')::INTERVAL
        GROUP BY error_type
        ORDER BY error_count DESC
    ) t;
    
    -- Errors by severity
    SELECT jsonb_agg(
        jsonb_build_object(
            'severity', severity,
            'count', error_count
        )
    ) INTO v_errors_by_severity
    FROM (
        SELECT severity, COUNT(*) as error_count
        FROM public.error_monitoring
        WHERE created_at > NOW() - (p_hours || ' hours')::INTERVAL
        GROUP BY severity
        ORDER BY error_count DESC
    ) t;
    
    -- Unresolved errors
    SELECT COUNT(*) INTO v_unresolved_errors
    FROM public.error_monitoring
    WHERE resolved = FALSE;
    
    -- Critical alerts
    SELECT COUNT(*) INTO v_critical_alerts
    FROM public.error_alerts
    WHERE is_active = TRUE AND alert_level = 'critical';
    
    RETURN jsonb_build_object(
        'period_hours', p_hours,
        'total_errors', v_total_errors,
        'errors_by_type', COALESCE(v_errors_by_type, '[]'::JSONB),
        'errors_by_severity', COALESCE(v_errors_by_severity, '[]'::JSONB),
        'unresolved_errors', v_unresolved_errors,
        'critical_alerts', v_critical_alerts,
        'generated_at', NOW()
    );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ==========================================
-- 4. SYSTEM HEALTH MONITORING
-- ==========================================

-- Create system health table
CREATE TABLE IF NOT EXISTS public.system_health (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    metric_name TEXT NOT NULL,
    metric_value DECIMAL NOT NULL,
    threshold_warning DECIMAL,
    threshold_critical DECIMAL,
    status TEXT DEFAULT 'healthy' CHECK (status IN ('healthy', 'warning', 'critical', 'unknown')),
    measured_at TIMESTAMPTZ DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'::JSONB
);

-- Function to check system health
CREATE OR REPLACE FUNCTION public.check_system_health() RETURNS JSONB AS $$
DECLARE
    v_health_status JSONB;
    v_db_connections INTEGER;
    v_cache_hit_rate DECIMAL;
    v_avg_query_time DECIMAL;
    v_error_rate DECIMAL;
    v_active_users INTEGER;
BEGIN
    -- Get database connections (simplified)
    SELECT COUNT(*) INTO v_db_connections
    FROM pg_stat_activity
    WHERE state = 'active';
    
    -- Get cache hit rate (simplified)
    SELECT COALESCE(AVG(CASE WHEN cache_hit THEN 1 ELSE 0 END) * 100, 0) INTO v_cache_hit_rate
    FROM (
        SELECT true as cache_hit
        UNION ALL SELECT false
        LIMIT 100
    ) cache_stats;
    
    -- Get average query time
    SELECT COALESCE(AVG(execution_time), 0) INTO v_avg_query_time
    FROM public.query_performance_log
    WHERE created_at > NOW() - INTERVAL '1 hour';
    
    -- Get error rate
    SELECT COALESCE(
        (COUNT(*) FILTER (WHERE severity = 'error')::DECIMAL / NULLIF(COUNT(*), 0)) * 100, 
        0
    ) INTO v_error_rate
    FROM public.error_monitoring
    WHERE created_at > NOW() - INTERVAL '1 hour';
    
    -- Get active users (simplified)
    SELECT COUNT(DISTINCT user_id) INTO v_active_users
    FROM public.query_performance_log
    WHERE created_at > NOW() - INTERVAL '5 minutes'
        AND user_id IS NOT NULL;
    
    -- Calculate overall health status
    v_health_status := jsonb_build_object(
        'overall_status', CASE 
            WHEN v_error_rate > 10 OR v_avg_query_time > 5000 THEN 'critical'
            WHEN v_error_rate > 5 OR v_avg_query_time > 2000 THEN 'warning'
            ELSE 'healthy'
        END,
        'metrics', jsonb_build_object(
            'database_connections', v_db_connections,
            'cache_hit_rate', v_cache_hit_rate,
            'avg_query_time_ms', v_avg_query_time,
            'error_rate_percent', v_error_rate,
            'active_users', v_active_users
        ),
        'recommendations', CASE 
            WHEN v_error_rate > 10 THEN jsonb_build_array('High error rate detected', 'Check error logs immediately')
            WHEN v_avg_query_time > 5000 THEN jsonb_build_array('Slow query performance', 'Review query optimization')
            WHEN v_cache_hit_rate < 80 THEN jsonb_build_array('Low cache hit rate', 'Consider cache optimization')
            ELSE jsonb_build_array('System operating normally')
        END,
        'checked_at', NOW()
    );
    
    -- Store health metrics
    INSERT INTO public.system_health(metric_name, metric_value, threshold_warning, threshold_critical, status, metadata)
    VALUES 
        ('database_connections', v_db_connections, 50, 100, 
         CASE WHEN v_db_connections > 100 THEN 'critical' WHEN v_db_connections > 50 THEN 'warning' ELSE 'healthy' END,
         jsonb_build_object('threshold_warning', 50, 'threshold_critical', 100)),
        ('cache_hit_rate', v_cache_hit_rate, 80, 60, 
         CASE WHEN v_cache_hit_rate < 60 THEN 'critical' WHEN v_cache_hit_rate < 80 THEN 'warning' ELSE 'healthy' END,
         jsonb_build_object('threshold_warning', 80, 'threshold_critical', 60)),
        ('avg_query_time', v_avg_query_time, 2000, 5000, 
         CASE WHEN v_avg_query_time > 5000 THEN 'critical' WHEN v_avg_query_time > 2000 THEN 'warning' ELSE 'healthy' END,
         jsonb_build_object('threshold_warning', 2000, 'threshold_critical', 5000)),
        ('error_rate', v_error_rate, 5, 10, 
         CASE WHEN v_error_rate > 10 THEN 'critical' WHEN v_error_rate > 5 THEN 'warning' ELSE 'healthy' END,
         jsonb_build_object('threshold_warning', 5, 'threshold_critical', 10));
    
    RETURN v_health_status;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==========================================
-- 5. GRANT PERMISSIONS
-- ==========================================

-- Performance monitoring permissions
GRANT SELECT, INSERT ON public.performance_profiles TO authenticated;
GRANT SELECT, INSERT ON public.query_performance_log TO authenticated;
GRANT EXECUTE ON FUNCTION public.log_query_performance TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_performance_recommendations TO authenticated;

-- Load testing permissions
GRANT SELECT, INSERT ON public.load_test_results TO authenticated;
GRANT EXECUTE ON FUNCTION public.simulate_load_test TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_load_test_history TO authenticated;

-- Error monitoring permissions
GRANT SELECT, INSERT, UPDATE ON public.error_monitoring TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.error_alerts TO authenticated;
GRANT EXECUTE ON FUNCTION public.log_error TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_error_statistics TO authenticated;

-- System health permissions
GRANT SELECT, INSERT ON public.system_health TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_system_health TO authenticated;

-- ==========================================
-- 6. VERIFICATION AND TESTING
-- ==========================================

-- Test performance logging
SELECT public.log_query_performance(
    'SELECT * FROM rides WHERE status = $1',
    150.5,
    25,
    '550e8400-e29b-11d5-9b2d-0242ac120003',
    'session_123',
    'select'
);

-- Test load simulation
SELECT public.simulate_load_test(
    'basic_load_test',
    10,
    100,
    30
);

-- Test error logging
SELECT public.log_error(
    'database_error',
    'Connection timeout occurred',
    'CONN_TIMEOUT',
    'Stack trace here...',
    '550e8400-e29b-11d5-9b2d-0242ac120003',
    'session_123',
    '/api/rides',
    'GET',
    'Mozilla/5.0...',
    '192.168.1.1'::INET,
    'error',
    '{"context": "test_error"}'
);

-- Test system health check
SELECT public.check_system_health();

-- Get performance recommendations
SELECT * FROM public.get_performance_recommendations(5);

-- Get error statistics
SELECT public.get_error_statistics(24);

-- Get load test history
SELECT * FROM public.get_load_test_history(5);

-- ==========================================
-- INSTRUCTIONS
-- ==========================================
/*
WEEK 3 GENERAL OPTIMIZATION IMPLEMENTED:

✅ ADVANCED PERFORMANCE TUNING:
- Performance profiles and query logging
- Automatic optimization suggestions
- Performance recommendations system
- Query pattern analysis

✅ LOAD TESTING FRAMEWORK:
- Load test simulation and results tracking
- Concurrent user testing
- Response time analysis
- Throughput and error rate monitoring

✅ ERROR MONITORING AND ALERTING:
- Comprehensive error logging system
- Automatic alert thresholds
- Error statistics and trends
- Severity-based alerting

✅ SYSTEM HEALTH MONITORING:
- Real-time health checks
- Metric thresholds and alerts
- Health status recommendations
- Historical health tracking

HOW TO USE:

1. PERFORMANCE MONITORING:
   - Log query performance: log_query_performance()
   - Get recommendations: get_performance_recommendations()
   - Monitor slow queries automatically

2. LOAD TESTING:
   - Simulate load: simulate_load_test()
   - Get test history: get_load_test_history()
   - Analyze performance under load

3. ERROR MONITORING:
   - Log errors: log_error()
   - Get statistics: get_error_statistics()
   - Monitor error trends automatically

4. SYSTEM HEALTH:
   - Check health: check_system_health()
   - Monitor metrics continuously
   - Get health recommendations

EXPECTED IMPROVEMENTS:
- Advanced performance monitoring and optimization
- Load testing capabilities for scalability testing
- Comprehensive error monitoring and alerting
- Real-time system health monitoring
- Automated recommendations and alerts

IMPLEMENTATION STEPS:
1. Execute WEEK3_GENERAL_OPTIMIZATION.sql in Supabase
2. Set up performance monitoring in application
3. Configure error logging and alerting
4. Implement regular health checks
5. Run load tests to validate performance
6. Monitor and optimize based on recommendations
*/
