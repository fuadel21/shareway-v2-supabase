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
                const { latitude, longitude } = position.coords;

                try {
                    const { error } = await supabase
                        .from('rides')
                        .update({
                            current_location: {
                                latitude,
                                longitude,
                                timestamp: new Date().toISOString()
                            }
                        })
                        .eq('id', rideId);

                    if (error) throw error;

                } catch (error) {
                    toast.error("No se pudo actualizar tu ubicación en el mapa.");
                    stopTracking();
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
