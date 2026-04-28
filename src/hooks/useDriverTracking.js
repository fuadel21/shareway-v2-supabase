import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { toast } from 'sonner';

/**
 * Hook personalizado para el seguimiento de la ubicación de un conductor durante un viaje.
 * @param {string} rideId - El ID del viaje que se está siguiendo.
 */
export function useDriverTracking(rideId) {
    const [isTracking, setIsTracking] = useState(false);
    const watchIdRef = useRef(null);

    const stopTracking = useCallback(() => {
        if (watchIdRef.current !== null) {
            navigator.geolocation.clearWatch(watchIdRef.current);
            watchIdRef.current = null;
            setIsTracking(false);
        }
    }, []);

    const startTracking = useCallback(() => {
        if (!rideId) return;

        const options = {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 5000
        };

        watchIdRef.current = navigator.geolocation.watchPosition(
            async (position) => {
                const { latitude, longitude, heading } = position.coords;

                try {
                    const { updateRideLocation } = await import('@/lib/supabaseRPC');
                    const result = await updateRideLocation(rideId, latitude, longitude, heading || 0);

                    if (!result.success) throw new Error(result.error || "Error al actualizar ubicación");

                } catch (error) {
                    console.error("Tracking error:", error);
                }
            },
            (error) => {
                toast.error("No se pudo obtener tu ubicación en tiempo real.", {
                    description: error.message
                });
                stopTracking();
            },
            options
        );

        setIsTracking(true);
    }, [rideId, stopTracking]);

    useEffect(() => {
        return () => {
            stopTracking();
        };
    }, [stopTracking]);

    return { isTracking, startTracking, stopTracking };
}
