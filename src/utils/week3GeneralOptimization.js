// ==========================================
// WEEK 3: GENERAL OPTIMIZATION - Frontend Implementation
// ==========================================
// Performance tuning, load testing, and error monitoring

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { useOptimizedDataFetch } from '@/utils/week1Optimizations';

// ==========================================
// 1. PERFORMANCE MONITORING
// ==========================================

export function usePerformanceMonitoring() {
    const [performanceProfiles, setPerformanceProfiles] = useState([]);
    const [recommendations, setRecommendations] = useState([]);
    const [loading, setLoading] = useState(false);

    // Fetch performance recommendations with caching
    const { data: recommendationsData, refetch: refetchRecommendations } = useOptimizedDataFetch(
        'performance_recommendations',
        () => fetchPerformanceRecommendations(),
        {
            ttl: 60000, // 1 minute cache
            pollingInterval: 30000 // Poll every 30 seconds
        }
    );

    const fetchPerformanceRecommendations = async () => {
        try {
            const { data, error } = await supabase.rpc('get_performance_recommendations', {
                p_limit: 10
            });

            if (error) throw error;
            return data || [];
        } catch (error) {
            console.error('Error fetching performance recommendations:', error);
            return [];
        }
    };

    const logQueryPerformance = useCallback(async (queryText, executionTime, rowsReturned, queryType) => {
        try {
            await supabase.rpc('log_query_performance', {
                p_query_text: queryText,
                p_execution_time: executionTime,
                p_rows_returned: rowsReturned,
                p_user_id: null, // Will be set by auth.uid() in the RPC
                p_session_id: null,
                p_query_type: queryType
            });
        } catch (error) {
            console.error('Error logging query performance:', error);
        }
    }, []);

    // Update recommendations when data changes
    useEffect(() => {
        setRecommendations(recommendationsData || []);
    }, [recommendationsData]);

    return {
        performanceProfiles,
        recommendations,
        loading,
        logQueryPerformance,
        refetchRecommendations
    };
}

// Performance Recommendations Component
export function PerformanceRecommendations({ recommendations }) {
    const getPriorityColor = (priority) => {
        switch (priority) {
            case 'HIGH': return 'text-red-600 bg-red-50';
            case 'MEDIUM': return 'text-yellow-600 bg-yellow-50';
            case 'LOW': return 'text-blue-600 bg-blue-50';
            default: return 'text-gray-600 bg-gray-50';
        }
    };

    const getPriorityIcon = (priority) => {
        switch (priority) {
            case 'HIGH': return '🚨';
            case 'MEDIUM': return '⚠️';
            case 'LOW': return 'ℹ️';
            default: return '📊';
        }
    };

    if (!recommendations || recommendations.length === 0) {
        return (
            <div className="bg-white rounded-lg border border-gray-200 p-6">
                <h3 className="text-lg font-semibold mb-4">Performance Recommendations</h3>
                <div className="text-center py-8 text-gray-500">
                    <div className="text-4xl mb-2">🚀</div>
                    <p>No performance recommendations available</p>
                    <p className="text-sm mt-2">Your system is performing optimally!</p>
                </div>
            </div>
        );
    }

    return (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h3 className="text-lg font-semibold mb-4">Performance Recommendations</h3>
            <div className="space-y-4">
                {recommendations.map((rec, index) => (
                    <div key={index} className={`p-4 rounded-lg border ${getPriorityColor(rec.priority)}`}>
                        <div className="flex items-start gap-3">
                            <div className="text-2xl">{getPriorityIcon(rec.priority)}</div>
                            <div className="flex-1">
                                <div className="flex justify-between items-start mb-2">
                                    <h4 className="font-medium">Query Pattern: {rec.query_pattern.substring(0, 20)}...</h4>
                                    <span className={`text-xs px-2 py-1 rounded-full ${getPriorityColor(rec.priority)}`}>
                                        {rec.priority}
                                    </span>
                                </div>
                                <div className="text-sm space-y-1">
                                    <p>Avg Execution Time: {rec.avg_execution_time?.toFixed(2)}ms</p>
                                    <p>Query Count: {rec.query_count}</p>
                                    {rec.optimization_suggestion && rec.optimization_suggestion.length > 0 && (
                                        <div className="mt-2 p-2 bg-white bg-opacity-50 rounded">
                                            <p className="font-medium">Suggestion:</p>
                                            <p className="text-sm">{rec.optimization_suggestion[0]?.suggestion}</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

// ==========================================
// 2. LOAD TESTING
// ==========================================

export function useLoadTesting() {
    const [loadTests, setLoadTests] = useState([]);
    const [loading, setLoading] = useState(false);
    const [currentTest, setCurrentTest] = useState(null);

    // Fetch load test history with caching
    const { data: loadTestsData, refetch: refetchLoadTests } = useOptimizedDataFetch(
        'load_test_history',
        () => fetchLoadTestHistory(),
        {
            ttl: 30000, // 30 seconds cache
            pollingInterval: 15000 // Poll every 15 seconds
        }
    );

    const fetchLoadTestHistory = async () => {
        try {
            const { data, error } = await supabase.rpc('get_load_test_history', {
                p_limit: 20
            });

            if (error) throw error;
            return data || [];
        } catch (error) {
            console.error('Error fetching load test history:', error);
            return [];
        }
    };

    const simulateLoadTest = useCallback(async (testName, concurrentUsers, requestsPerSecond, durationSeconds) => {
        try {
            setLoading(true);
            setCurrentTest({ testName, status: 'running' });

            const { data, error } = await supabase.rpc('simulate_load_test', {
                p_test_name: testName,
                p_concurrent_users: concurrentUsers,
                p_requests_per_second: requestsPerSecond,
                p_duration_seconds: durationSeconds
            });

            if (error) throw error;

            setCurrentTest({ testName, status: 'completed', result: data });
            refetchLoadTests(); // Refresh history

            return data;
        } catch (error) {
            console.error('Error simulating load test:', error);
            setCurrentTest({ testName, status: 'error', error: error.message });
            throw error;
        } finally {
            setLoading(false);
        }
    }, [refetchLoadTests]);

    // Update load tests when data changes
    useEffect(() => {
        setLoadTests(loadTestsData || []);
    }, [loadTestsData]);

    return {
        loadTests,
        loading,
        currentTest,
        simulateLoadTest,
        refetchLoadTests
    };
}

// Load Testing Component
export function LoadTesting({ onSimulateTest }) {
    const [testConfig, setTestConfig] = useState({
        testName: '',
        concurrentUsers: 10,
        requestsPerSecond: 100,
        durationSeconds: 60
    });

    const { loading, currentTest } = useLoadTesting();

    const handleSimulateTest = () => {
        if (!testConfig.testName.trim()) {
            toast.error('Please enter a test name');
            return;
        }

        onSimulateTest(testConfig);
    };

    return (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h3 className="text-lg font-semibold mb-4">Load Testing</h3>
            
            <div className="grid grid-cols-2 gap-4 mb-6">
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Test Name</label>
                    <input
                        type="text"
                        value={testConfig.testName}
                        onChange={(e) => setTestConfig(prev => ({ ...prev, testName: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="Enter test name"
                    />
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Concurrent Users</label>
                    <input
                        type="number"
                        value={testConfig.concurrentUsers}
                        onChange={(e) => setTestConfig(prev => ({ ...prev, concurrentUsers: parseInt(e.target.value) || 1 }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        min="1"
                        max="1000"
                    />
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Requests/Second</label>
                    <input
                        type="number"
                        value={testConfig.requestsPerSecond}
                        onChange={(e) => setTestConfig(prev => ({ ...prev, requestsPerSecond: parseInt(e.target.value) || 1 }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        min="1"
                        max="10000"
                    />
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Duration (seconds)</label>
                    <input
                        type="number"
                        value={testConfig.durationSeconds}
                        onChange={(e) => setTestConfig(prev => ({ ...prev, durationSeconds: parseInt(e.target.value) || 10 }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        min="10"
                        max="300"
                    />
                </div>
            </div>

            <button
                onClick={handleSimulateTest}
                disabled={loading}
                className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
                {loading ? 'Running Test...' : 'Start Load Test'}
            </button>

            {currentTest && (
                <div className="mt-4 p-4 bg-gray-50 rounded-lg">
                    <h4 className="font-medium mb-2">Current Test Status</h4>
                    <div className="text-sm space-y-1">
                        <p>Test: {currentTest.testName}</p>
                        <p>Status: {currentTest.status}</p>
                        {currentTest.result && (
                            <div className="mt-2 p-2 bg-white rounded">
                                <p>Avg Response Time: {currentTest.result.avg_response_time?.toFixed(2)}ms</p>
                                <p>Error Rate: {currentTest.result.error_rate?.toFixed(2)}%</p>
                                <p>Throughput: {currentTest.result.throughput?.toFixed(2)} req/s</p>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

// ==========================================
// 3. ERROR MONITORING
// ==========================================

export function useErrorMonitoring() {
    const [errorStats, setErrorStats] = useState({});
    const [loading, setLoading] = useState(false);

    // Fetch error statistics with caching
    const { data: errorStatsData, refetch: refetchErrorStats } = useOptimizedDataFetch(
        'error_statistics',
        () => fetchErrorStatistics(),
        {
            ttl: 30000, // 30 seconds cache
            pollingInterval: 15000 // Poll every 15 seconds
        }
    );

    const fetchErrorStatistics = async () => {
        try {
            const { data, error } = await supabase.rpc('get_error_statistics', {
                p_hours: 24
            });

            if (error) throw error;
            return data || {};
        } catch (error) {
            console.error('Error fetching error statistics:', error);
            return {};
        }
    };

    const logError = useCallback(async (errorType, errorMessage, errorCode, stackTrace, metadata) => {
        try {
            await supabase.rpc('log_error', {
                p_error_type: errorType,
                p_error_message: errorMessage,
                p_error_code: errorCode,
                p_stack_trace: stackTrace,
                p_user_id: null, // Will be set by auth.uid() in the RPC
                p_session_id: null,
                p_request_path: window.location.pathname,
                p_request_method: 'GET',
                p_user_agent: navigator.userAgent,
                p_ip_address: null,
                p_severity: 'error',
                p_metadata: metadata || {}
            });
        } catch (error) {
            console.error('Error logging error:', error);
        }
    }, []);

    // Update error stats when data changes
    useEffect(() => {
        setErrorStats(errorStatsData || {});
    }, [errorStatsData]);

    return {
        errorStats,
        loading,
        logError,
        refetchErrorStats
    };
}

// Error Statistics Component
export function ErrorStatistics({ errorStats }) {
    if (!errorStats || Object.keys(errorStats).length === 0) {
        return (
            <div className="bg-white rounded-lg border border-gray-200 p-6">
                <h3 className="text-lg font-semibold mb-4">Error Statistics</h3>
                <div className="text-center py-8 text-gray-500">
                    <div className="text-4xl mb-2">✅</div>
                    <p>No errors detected in the last 24 hours</p>
                </div>
            </div>
        );
    }

    const getSeverityColor = (severity) => {
        switch (severity) {
            case 'critical': return 'text-red-600 bg-red-50';
            case 'error': return 'text-orange-600 bg-orange-50';
            case 'warning': return 'text-yellow-600 bg-yellow-50';
            default: return 'text-gray-600 bg-gray-50';
        }
    };

    return (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h3 className="text-lg font-semibold mb-4">Error Statistics (Last 24 Hours)</h3>
            
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div className="text-center">
                    <div className="text-2xl font-bold text-blue-600">{errorStats.total_errors || 0}</div>
                    <div className="text-sm text-gray-500">Total Errors</div>
                </div>
                <div className="text-center">
                    <div className="text-2xl font-bold text-orange-600">{errorStats.unresolved_errors || 0}</div>
                    <div className="text-sm text-gray-500">Unresolved</div>
                </div>
                <div className="text-center">
                    <div className="text-2xl font-bold text-red-600">{errorStats.critical_alerts || 0}</div>
                    <div className="text-sm text-gray-500">Critical Alerts</div>
                </div>
                <div className="text-center">
                    <div className="text-2xl font-bold text-green-600">
                        {errorStats.error_rate ? (100 - parseFloat(errorStats.error_rate)).toFixed(1) : 100}%
                    </div>
                    <div className="text-sm text-gray-500">Success Rate</div>
                </div>
            </div>

            <div className="space-y-4">
                {errorStats.errors_by_type && Object.keys(errorStats.errors_by_type).length > 0 && (
                    <div>
                        <h4 className="font-medium mb-2">Errors by Type</h4>
                        <div className="space-y-2">
                            {errorStats.errors_by_type.map((errorType, index) => (
                                <div key={index} className="flex justify-between items-center p-2 bg-gray-50 rounded">
                                    <span className="text-sm font-medium">{errorType.error_type}</span>
                                    <span className="text-sm text-gray-600">{errorType.count}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {errorStats.errors_by_severity && Object.keys(errorStats.errors_by_severity).length > 0 && (
                    <div>
                        <h4 className="font-medium mb-2">Errors by Severity</h4>
                        <div className="space-y-2">
                            {errorStats.errors_by_severity.map((severity, index) => (
                                <div key={index} className={`flex justify-between items-center p-2 rounded ${getSeverityColor(severity.severity)}`}>
                                    <span className="text-sm font-medium capitalize">{severity.severity}</span>
                                    <span className="text-sm">{severity.count}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

// ==========================================
// 4. SYSTEM HEALTH MONITORING
// ==========================================

export function useSystemHealth() {
    const [healthStatus, setHealthStatus] = useState({});
    const [loading, setLoading] = useState(false);

    // Fetch system health with caching
    const { data: healthData, refetch: refetchHealth } = useOptimizedDataFetch(
        'system_health',
        () => fetchSystemHealth(),
        {
            ttl: 30000, // 30 seconds cache
            pollingInterval: 15000 // Poll every 15 seconds
        }
    );

    const fetchSystemHealth = async () => {
        try {
            const { data, error } = await supabase.rpc('check_system_health');

            if (error) throw error;
            return data || {};
        } catch (error) {
            console.error('Error fetching system health:', error);
            return {};
        }
    };

    // Update health status when data changes
    useEffect(() => {
        setHealthStatus(healthData || {});
    }, [healthData]);

    return {
        healthStatus,
        loading,
        refetchHealth
    };
}

// System Health Component
export function SystemHealth({ healthStatus }) {
    if (!healthStatus || Object.keys(healthStatus).length === 0) {
        return (
            <div className="bg-white rounded-lg border border-gray-200 p-6">
                <h3 className="text-lg font-semibold mb-4">System Health</h3>
                <div className="text-center py-8 text-gray-500">
                    <div className="text-4xl mb-2">🏥</div>
                    <p>Loading system health...</p>
                </div>
            </div>
        );
    }

    const getStatusColor = (status) => {
        switch (status) {
            case 'healthy': return 'text-green-600 bg-green-50';
            case 'warning': return 'text-yellow-600 bg-yellow-50';
            case 'critical': return 'text-red-600 bg-red-50';
            default: return 'text-gray-600 bg-gray-50';
        }
    };

    const getStatusIcon = (status) => {
        switch (status) {
            case 'healthy': return '✅';
            case 'warning': return '⚠️';
            case 'critical': return '🚨';
            default: return '❓';
        }
    };

    return (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h3 className="text-lg font-semibold mb-4">System Health</h3>
            
            <div className={`p-4 rounded-lg border-2 ${getStatusColor(healthStatus.overall_status)}`}>
                <div className="flex items-center gap-3 mb-4">
                    <div className="text-2xl">{getStatusIcon(healthStatus.overall_status)}</div>
                    <div>
                        <h4 className="font-medium capitalize">{healthStatus.overall_status}</h4>
                        <p className="text-sm text-gray-500">Overall System Status</p>
                    </div>
                </div>
            </div>

            {healthStatus.metrics && (
                <div className="mt-6 space-y-4">
                    <h4 className="font-medium">System Metrics</h4>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                        <div className="text-center">
                            <div className="text-lg font-bold text-blue-600">
                                {healthStatus.metrics.database_connections || 0}
                            </div>
                            <div className="text-xs text-gray-500">DB Connections</div>
                        </div>
                        <div className="text-center">
                            <div className="text-lg font-bold text-green-600">
                                {healthStatus.metrics.cache_hit_rate?.toFixed(1) || 0}%
                            </div>
                            <div className="text-xs text-gray-500">Cache Hit Rate</div>
                        </div>
                        <div className="text-center">
                            <div className="text-lg font-bold text-orange-600">
                                {healthStatus.metrics.avg_query_time_ms?.toFixed(1) || 0}ms
                            </div>
                            <div className="text-xs text-gray-500">Avg Query Time</div>
                        </div>
                        <div className="text-center">
                            <div className="text-lg font-bold text-red-600">
                                {healthStatus.metrics.error_rate?.toFixed(1) || 0}%
                            </div>
                            <div className="text-xs text-gray-500">Error Rate</div>
                        </div>
                        <div className="text-center">
                            <div className="text-lg font-bold text-purple-600">
                                {healthStatus.metrics.active_users || 0}
                            </div>
                            <div className="text-xs text-gray-500">Active Users</div>
                        </div>
                    </div>
                </div>
            )}

            {healthStatus.recommendations && healthStatus.recommendations.length > 0 && (
                <div className="mt-6">
                    <h4 className="font-medium mb-2">Recommendations</h4>
                    <div className="space-y-2">
                        {healthStatus.recommendations.map((rec, index) => (
                            <div key={index} className="p-2 bg-blue-50 rounded text-sm text-blue-700">
                                {rec}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className="mt-4 text-xs text-gray-500 text-right">
                Last checked: {healthStatus.checked_at ? new Date(healthStatus.checked_at).toLocaleString() : 'Unknown'}
            </div>
        </div>
    );
}

// ==========================================
// 5. COMPREHENSIVE OPTIMIZATION DASHBOARD
// ==========================================

export function OptimizationDashboard() {
    const { recommendations, logQueryPerformance } = usePerformanceMonitoring();
    const { simulateLoadTest, loadTests, currentTest } = useLoadTesting();
    const { errorStats, logError } = useErrorMonitoring();
    const { healthStatus } = useSystemHealth();

    // Automatic performance logging for API calls
    const logApiCall = useCallback(async (apiCall, executionTime, resultCount) => {
        await logQueryPerformance(apiCall, executionTime, resultCount, 'api_call');
    }, [logQueryPerformance]);

    // Automatic error logging
    const handleError = useCallback(async (error, context) => {
        await logError(error.name || 'unknown_error', error.message, error.code, error.stack, context);
    }, [logError]);

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <SystemHealth healthStatus={healthStatus} />
                <ErrorStatistics errorStats={errorStats} />
            </div>
            
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <PerformanceRecommendations recommendations={recommendations} />
                <LoadTesting onSimulateTest={simulateLoadTest} />
            </div>

            {currentTest && currentTest.status === 'running' && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <div className="flex items-center gap-3">
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                        <span className="text-blue-800">Load test "{currentTest.testName}" is running...</span>
                    </div>
                </div>
            )}
        </div>
    );
}

// ==========================================
// INSTRUCTIONS
// ==========================================
/*
WEEK 3 GENERAL OPTIMIZATION - FRONTEND IMPLEMENTATION

✅ PERFORMANCE MONITORING:
- usePerformanceMonitoring hook for performance tracking
- PerformanceRecommendations component
- Automatic query performance logging
- Performance recommendations display

✅ LOAD TESTING:
- useLoadTesting hook for load testing
- LoadTesting component with configuration
- Load test simulation and history
- Real-time test status updates

✅ ERROR MONITORING:
- useErrorMonitoring hook for error tracking
- ErrorStatistics component with charts
- Automatic error logging
- Error trends and statistics

✅ SYSTEM HEALTH MONITORING:
- useSystemHealth hook for health checks
- SystemHealth component with metrics
- Real-time health status
- Health recommendations

✅ COMPREHENSIVE DASHBOARD:
- OptimizationDashboard component
- Integration of all monitoring features
- Real-time updates and alerts
- Performance, load, error, and health monitoring

HOW TO USE:

1. PERFORMANCE MONITORING:
   const { logQueryPerformance } = usePerformanceMonitoring();
   logQueryPerformance('SELECT * FROM rides', 150, 25, 'select');

2. LOAD TESTING:
   const { simulateLoadTest } = useLoadTesting();
   simulateLoadTest('test_name', 10, 100, 60);

3. ERROR MONITORING:
   const { logError } = useErrorMonitoring();
   logError('database_error', 'Connection timeout', 'CONN_TIMEOUT');

4. SYSTEM HEALTH:
   const { healthStatus } = useSystemHealth();
   <SystemHealth healthStatus={healthStatus} />

5. COMPREHENSIVE DASHBOARD:
   <OptimizationDashboard />

EXPECTED IMPROVEMENTS:
- Real-time performance monitoring
- Load testing capabilities
- Comprehensive error tracking
- System health monitoring
- Automated recommendations and alerts
- Performance optimization insights

IMPLEMENTATION STEPS:
1. Execute WEEK3_GENERAL_OPTIMIZATION.sql in Supabase
2. Add OptimizationDashboard to your admin panel
3. Implement automatic performance logging
4. Set up error monitoring in error boundaries
5. Configure regular health checks
6. Monitor and optimize based on insights
*/
