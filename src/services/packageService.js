import { supabase } from '../lib/supabase';

/**
 * Obtiene todos los paquetes asociados a un usuario (como remitente o transportista)
 * @param {string} userId 
 * @returns {Promise<Array>}
 */
export const getUserPackages = async (userId) => {
    try {
        const { data, error } = await supabase
            .from('packages')
            .select(`
                *,
                sender:profiles!packages_sender_id_fkey(*),
                driver:profiles!packages_driver_id_fkey(*)
            `)
            .or(`sender_id.eq.${userId},driver_id.eq.${userId}`)
            .order('created_at', { ascending: false });

        if (error) throw error;
        return data || [];
    } catch (error) {
        console.error("Error getUserPackages:", error);
        return [];
    }
};

/**
 * Obtiene los detalles de un paquete por ID
 * @param {string} packageId 
 * @returns {Promise<object>}
 */
export const getPackageDetails = async (packageId) => {
    try {
        const { data, error } = await supabase
            .from('packages')
            .select(`
                *,
                sender:profiles!packages_sender_id_fkey(*),
                driver:profiles!packages_driver_id_fkey(*)
            `)
            .eq('id', packageId)
            .single();

        if (error) throw error;
        return data;
    } catch (error) {
        console.error("Error getPackageDetails:", error);
        throw error;
    }
};

/**
 * Actualiza el estado de un paquete
 * @param {string} packageId 
 * @param {string} status 
 * @param {object} additionalData 
 */
export const updatePackageStatus = async (packageId, status, additionalData = {}) => {
    try {
        const { data, error } = await supabase
            .from('packages')
            .update({
                status,
                ...additionalData
            })
            .eq('id', packageId)
            .select()
            .single();

        if (error) throw error;
        return data;
    } catch (error) {
        console.error("Error updatePackageStatus:", error);
        throw error;
    }
};

/**
 * Acepta un envío como transportista
 * @param {string} packageId 
 * @param {string} driverId 
 */
export const acceptPackage = async (packageId, driverId) => {
    return updatePackageStatus(packageId, 'accepted', { driver_id: driverId });
};
