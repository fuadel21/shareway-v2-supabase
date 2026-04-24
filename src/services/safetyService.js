/**
 * Servicio de Seguridad & SOS - Blindaje Crítico v1.0
 */
import { supabase } from '@/lib/supabase';
import * as rpc from '@/lib/supabaseRPC';
import { toast } from 'sonner';

/**
 * Activa la alerta SOS de emergencia
 */
export const triggerSOS = async (rideId) => {
    try {
        // 1. Obtener ubicación actual para la alerta
        const location = await new Promise((resolve) => {
            if (!navigator.geolocation) return resolve(null);
            navigator.geolocation.getCurrentPosition(
                (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
                () => resolve(null),
                { enableHighAccuracy: true, timeout: 5000 }
            );
        });

        // 2. Llamar al RPC de emergencia
        const { data, success, error } = await rpc.safeCall(
            () => supabase.rpc('trigger_emergency_alert_v2', {
                p_ride_id: rideId,
                p_current_location: location
            }),
            'trigger_emergency_alert_v2'
        );

        if (!success) throw new Error(error);

        toast.error("🚨 ALERTA SOS ACTIVADA", {
            description: "Tus contactos y el centro de control han sido notificados.",
            duration: 10000
        });

        return { success: true, alertId: data.alertId };
    } catch (error) {
        console.error("🛡️ [Safety] SOS trigger failed:", error);
        toast.error("Error al activar SOS", {
            description: "Intenta llamar directamente a emergencias si es necesario."
        });
        throw error;
    }
};

/**
 * Obtiene los contactos de emergencia del usuario
 */
export const getEmergencyContacts = async (userId) => {
    try {
        const { data, error } = await supabase
            .from('emergency_contacts')
            .select('*')
            .eq('user_id', userId);

        if (error) throw error;
        return data || [];
    } catch (error) {
        console.error("🛡️ [Safety] Failed to fetch emergency contacts:", error);
        return [];
    }
};

/**
 * Añade un contacto de emergencia
 */
export const addEmergencyContact = async (userId, contactData) => {
    try {
        const { data, error } = await supabase
            .from('emergency_contacts')
            .insert([{
                user_id: userId,
                name: contactData.name,
                phone: contactData.phone,
                relationship: contactData.relationship
            }])
            .select()
            .single();

        if (error) throw error;
        return data;
    } catch (error) {
        console.error("🛡️ [Safety] Failed to add emergency contact:", error);
        throw error;
    }
};
