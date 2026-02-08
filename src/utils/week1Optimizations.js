import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';

class PollingManager {
    constructor() {
        this.cache = new Map();
        this.pendingFetches = new Map();
    }

    async getCachedOrFetch(cacheKey, fetchFunction, ttl = 30000) {
        const cached = this.cache.get(cacheKey);
        if (cached && Date.now() < cached.expiresAt) return cached.data;
        if (this.pendingFetches.has(cacheKey)) return this.pendingFetches.get(cacheKey);

        const fetchPromise = (async () => {
            try {
                const freshData = await fetchFunction();
                this.cache.set(cacheKey, { data: freshData, expiresAt: Date.now() + ttl });
                return freshData;
            } catch (error) {
                console.error(`🛡️ [Cache Manager] Error:`, error);
                return []; // Devolvemos array vacío en caso de error para no romper la UI
            } finally {
                this.pendingFetches.delete(cacheKey);
            }
        })();
        this.pendingFetches.set(cacheKey, fetchPromise);
        return fetchPromise;
    }

    clearCache(cacheKey) { if (cacheKey) this.cache.delete(cacheKey); }
}

export const globalPollingManager = new PollingManager();

export function useOptimizedDataFetch(cacheKey, fetchFunction, options = {}) {
    const { ttl = 30000, dependencies = [] } = options;
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const isMountedRef = useRef(true);
    const fetchRef = useRef(fetchFunction);

    useEffect(() => { fetchRef.current = fetchFunction; }, [fetchFunction]);

    const fetchData = useCallback(async (force = false) => {
        if (!isMountedRef.current || !cacheKey || cacheKey.includes('undefined')) {
            setLoading(false);
            return;
        }
        if (force) globalPollingManager.clearCache(cacheKey);
        try {
            if (!data || force) setLoading(true);
            const result = await globalPollingManager.getCachedOrFetch(cacheKey, fetchRef.current, ttl);
            if (isMountedRef.current) setData(result);
        } finally {
            if (isMountedRef.current) setLoading(false);
        }
    }, [cacheKey, ttl, data]);

    useEffect(() => { fetchData(); }, [cacheKey, ...dependencies]);
    useEffect(() => { return () => { isMountedRef.current = false; }; }, []);

    return { data, loading, refetch: (force) => fetchData(force) };
}

export const cachedAPI = {
    getUserRideHistory: async (userId) => {
        if (!userId) return [];
        
        console.log("🚀 [cachedAPI] Llamando a fetch_my_activity_v1 para:", userId);
        
        // LLAMADA DIRECTA AL NUEVO RPC
        const { data, error } = await supabase.rpc('fetch_my_activity_v1', { 
            p_user_id: userId
        });
        
        if (error) {
            console.error("❌ Error RPC fetch_my_activity_v1:", error);
            return [];
        }
        
        console.log("✅ Datos recibidos del RPC:", data?.length || 0, "viajes");
        return data || [];
    }
};

export const performanceUtils = {
    measureTime: async (fn) => {
        const start = performance.now();
        const result = await fn();
        return { result, duration: performance.now() - start };
    }
};
