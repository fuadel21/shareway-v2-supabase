/**
 * Servicio de Seguridad & SOS - Blindaje Crítico v1.0
 */
import { supabase } from '@/lib/supabase';
import { triggerEmergencyAlertV2 } from '@/lib/emergencyRPC';
import { toast } from 'sonner';

/**
 * Construye el enlace de WhatsApp para avisar a un guardián.
 */
export const buildGuardianWhatsAppLink = (phone, { name, rideId, location } = {}) => {
    const digits = String(phone || '').replace(/[^0-9]/g, '');
    if (!digits) return null;
    const lines = [
        `🚨 ALERTA ShareWay de ${name || 'un usuario'}`,
        location ? `📍 Ubicación en vivo: https://maps.google.com/?q=${location.lat},${location.lng}` : null,
        rideId ? `🔗 Seguimiento del viaje: https://shareway.es/emergency/${rideId}` : null,
        'Estoy en un viaje compartido y he activado el botón de SOS. Por favor, contáctame.',
    ].filter(Boolean);
    return `https://wa.me/${digits}?text=${encodeURIComponent(lines.join('\n'))}`;
};

/**
 * Activa la alerta SOS de emergencia
 */
export const triggerSOS = async (rideId) => {
    try {
        const location = await new Promise((resolve) => {
            if (!navigator.geolocation) return resolve(null);
            navigator.geolocation.getCurrentPosition(
                (pos) => resolve({
                    lat: pos.coords.latitude,
                    lng: pos.coords.longitude,
                    accuracy: pos.coords.accuracy ?? null,
                    captured_at: new Date().toISOString()
                }),
                () => resolve(null),
                { enableHighAccuracy: true, timeout: 5000 }
            );
        });

        const { data, success, error } = await triggerEmergencyAlertV2(
            rideId,
            location,
            {
                source: 'client',
                user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
            }
        );

        if (!success) throw new Error(error);

        const alertId = data?.alertId || data?.alert_id || null;
        const chatId = data?.chatId || data?.chat_id || null;

        toast.error("🚨 ALERTA SOS ACTIVADA", {
            description: "Alerta registrada. Mantén el canal abierto y llama al 112 si hay peligro inmediato.",
            duration: 10000
        });

        return { success: true, alertId, chatId, raw: data };

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
