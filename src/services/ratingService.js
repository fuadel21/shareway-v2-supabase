/**
 * Rating Service - Sistema de Reputación Elite v3.0
 * Optimización: Validaciones atómicas y cálculos escalables.
 */

import { supabase } from '@/lib/supabase';
import { safeCall } from '@/lib/supabaseRPC';

/**
 * Envía una valoración usando el motor hardened de la base de datos.
 * Las validaciones de tiempo y participación ocurren en el servidor.
 */
export const submitReview = async ({ rideId, revieweeId, rating, comment = '' }) => {
    try {
        const { data: authData } = await supabase.auth.getUser();
        const user = authData?.user;

        if (user?.id && revieweeId === user.id) {
            throw new Error('No puedes valorarte a ti mismo');
        }

        const ratingVal = parseInt(rating);
        if (isNaN(ratingVal) || ratingVal < 1 || ratingVal > 5) {
            throw new Error('El rating debe estar entre 1 y 5');
        }

        if (comment && comment.length > 500) {
            throw new Error('El comentario no puede exceder los 500 caracteres');
        }

        const { success, error, data } = await safeCall(
            () => supabase.rpc('submit_review_v2', {
                p_ride_id: rideId,
                p_reviewee_id: revieweeId,
                p_rating: ratingVal,
                p_comment: (comment || '').trim().substring(0, 1000)
            }),
            'submit_review_v2'
        );

        if (!success) {
            // Mapeo de errores de negocio para la UI
            if (error?.includes('ALREADY_REVIEWED')) throw new Error("Ya has valorado a este usuario.");
            if (error?.includes('INVALID_PARTICIPANT')) throw new Error("Solo los participantes del viaje pueden valorarse.");
            if (error?.includes('RIDE_NOT_COMPLETED')) throw new Error("El viaje debe estar finalizado para valorar.");
            throw new Error(error || 'Error al procesar la valoración');
        }

        return data;
    } catch (error) {
        console.error('🛡️ [Rating Service] submitReview failed:', error);
        throw error;
    }
};

export const submitReviewSecure = submitReview;

/**
 * Obtiene el perfil de reputación de un usuario (Rating + Badges + Estadísticas)
 * Optimizado para cargar en una sola llamada.
 */
export const getUserReputation = async (userId) => {
    try {
        const { data, success, error } = await safeCall(
            () => supabase.rpc('get_user_reputation_profile', { p_user_id: userId }),
            'get_user_reputation_profile'
        );

        if (!success) throw new Error(error);
        return data;
    } catch (error) {
        console.error('🛡️ [Rating Service] getUserReputation failed:', error);
        throw error;
    }
};

/**
 * Obtiene las reseñas reales escritas por otros usuarios.
 */
export const getUserReviews = async (userId, { limit = 10, offset = 0 } = {}) => {
    try {
        const { data, error } = await supabase
            .from('reviews')
            .select(`
                id,
                rating,
                comment,
                created_at,
                reviewer:profiles!reviewer_id(display_name, photo_url, is_verified)
            `)
            .eq('reviewee_id', userId)
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (error) throw error;
        return data;
    } catch (error) {
        console.error('🛡️ [Rating Service] getUserReviews failed:', error);
        throw error;
    }
};

/**
 * Verifica si el usuario actual tiene pendiente valorar este viaje.
 */
export const checkPendingReview = async (rideId) => {
    try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return false;

        const { data, error } = await supabase.rpc('check_pending_review', {
            p_ride_id: rideId,
            p_user_id: user.id
        });

        if (error) throw error;
        return data; // Devuelve true/false
    } catch (error) {
        console.error('🛡️ [Rating Service] checkPendingReview failed:', error);
        return false;
    }
};

/**
 * Obtiene el Leaderboard global (Conductores Elite)
 */
export const getTopDrivers = async (limit = 10) => {
    const { data, error } = await supabase
        .from('profiles')
        .select('id, display_name, photo_url, rating, total_rides')
        .eq('is_verified', true)
        .order('rating', { ascending: false })
        .limit(limit);

    if (error) throw error;
    return data;
};
