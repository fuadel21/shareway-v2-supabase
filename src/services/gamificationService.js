/**
 * Gamification Service - Sistema Completo de Gamificación
 * Manejo de EcoPoints, niveles, desafíos y recompensas
 */

import { supabase } from '@/lib/supabase';
import { safeCall } from '@/lib/supabaseRPC';

/**
 * Añade EcoPoints a un usuario
 * @param {string} userId - ID del usuario
 * @param {number} amount - Cantidad de puntos (positivo o negativo)
 * @param {string} sourceType - Tipo de fuente
 * @param {Object} options - Opciones adicionales
 * @returns {Promise<Object>} Resultado de la operación
 */
export const addEcoPoints = async (
    userId,
    amount,
    sourceType,
    { sourceId, description, metadata, expiresAt } = {}
) => {
    try {
        const { success, error, data } = await safeCall(
            () => supabase.rpc('add_ecopoints', {
                p_user_id: userId,
                p_amount: amount,
                p_source_type: sourceType,
                p_source_id: sourceId,
                p_description: description || '',
                p_metadata: metadata || {},
                p_expires_at: expiresAt || null
            }),
            'add_ecopoints'
        );

        if (!success) {
            throw new Error(error || 'Error al añadir EcoPoints');
        }

        return data;
    } catch (error) {
        console.error('🛡️ [Gamification Service] addEcoPoints failed:', error);
        throw error;
    }
};

/**
 * Obtiene balance de EcoPoints de un usuario
 * @param {string} userId - ID del usuario
 * @returns {Promise<Object>} Balance y estadísticas de puntos
 */
export const getEcoPointsBalance = async (userId) => {
    try {
        const { data, error } = await supabase
            .rpc('get_ecopoints_balance', { p_user_id: userId });

        if (error) {
            throw new Error(error.message);
        }

        return data;
    } catch (error) {
        console.error('🛡️ [Gamification Service] getEcoPointsBalance failed:', error);
        throw error;
    }
};

/**
 * Obtiene historial de transacciones de EcoPoints
 * @param {string} userId - ID del usuario
 * @param {Object} options - Opciones de paginación
 * @returns {Promise<Object>} Historial de transacciones
 */
export const getEcoPointsHistory = async (
    userId,
    { limit = 20, offset = 0, sourceType } = {}
) => {
    try {
        let query = supabase
            .from('ecopoints_transactions')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false });

        if (sourceType) {
            query = query.eq('source_type', sourceType);
        }

        const { data, error, count } = await query.range(offset, offset + limit - 1);

        if (error) {
            throw new Error(error.message);
        }

        return {
            transactions: data || [],
            pagination: {
                limit,
                offset,
                total: count || 0,
                hasMore: (offset + limit) < (count || 0)
            }
        };
    } catch (error) {
        console.error('🛡️ [Gamification Service] getEcoPointsHistory failed:', error);
        throw error;
    }
};

/**
 * Actualiza racha de un usuario
 * @param {string} userId - ID del usuario
 * @param {string} streakType - Tipo de racha
 * @param {Date} activityDate - Fecha de actividad
 * @returns {Promise<Object>} Estado actualizado de la racha
 */
export const updateStreak = async (userId, streakType, activityDate = new Date()) => {
    try {
        const { success, error, data } = await safeCall(
            () => supabase.rpc('update_streak', {
                p_user_id: userId,
                p_streak_type: streakType,
                p_activity_date: activityDate.toISOString().split('T')[0]
            }),
            'update_streak'
        );

        if (!success) {
            throw new Error(error || 'Error al actualizar racha');
        }

        return data;
    } catch (error) {
        console.error('🛡️ [Gamification Service] updateStreak failed:', error);
        throw error;
    }
};

/**
 * Obtiene desafíos activos de un usuario
 * @param {string} userId - ID del usuario
 * @param {boolean} includeCompleted - Incluir desafíos completados
 * @returns {Promise<Object>} Desafíos del usuario
 */
export const getUserChallenges = async (userId, includeCompleted = false) => {
    try {
        const { data, error } = await supabase
            .rpc('get_user_challenges', {
                p_user_id: userId,
                p_include_completed: includeCompleted
            });

        if (error) {
            throw new Error(error.message);
        }

        return data;
    } catch (error) {
        console.error('🛡️ [Gamification Service] getUserChallenges failed:', error);
        throw error;
    }
};

/**
 * Actualiza progreso de desafíos
 * @param {string} userId - ID del usuario
 * @param {string} requirementType - Tipo de requerimiento
 * @param {number} increment - Incremento de progreso
 * @param {Object} metadata - Metadatos adicionales
 * @returns {Promise<Object>} Resultado de la actualización
 */
export const updateChallengeProgress = async (
    userId,
    requirementType,
    increment = 1,
    metadata = {}
) => {
    try {
        const { success, error, data } = await safeCall(
            () => supabase.rpc('update_challenge_progress', {
                p_user_id: userId,
                p_requirement_type: requirementType,
                p_increment: increment,
                p_metadata: metadata
            }),
            'update_challenge_progress'
        );

        if (!success) {
            throw new Error(error || 'Error al actualizar progreso');
        }

        return data;
    } catch (error) {
        console.error('🛡️ [Gamification Service] updateChallengeProgress failed:', error);
        throw error;
    }
};

/**
 * Obtiene leaderboard de gamificación
 * @param {string} type - Tipo de leaderboard ('points', 'level', 'streak')
 * @param {number} limit - Límite de resultados
 * @returns {Promise<Object>} Leaderboard
 */
export const getGamificationLeaderboard = async (type = 'points', limit = 50) => {
    try {
        const { data, error } = await supabase
            .rpc('get_gamification_leaderboard', {
                p_type: type,
                p_limit: limit
            });

        if (error) {
            throw new Error(error.message);
        }

        return data;
    } catch (error) {
        console.error('🛡️ [Gamification Service] getGamificationLeaderboard failed:', error);
        throw error;
    }
};

/**
 * Obtiene estadísticas completas de gamificación de un usuario
 * @param {string} userId - ID del usuario
 * @returns {Promise<Object>} Estadísticas de gamificación
 */
export const getUserGamificationStats = async (userId) => {
    try {
        const { data, error } = await supabase
            .rpc('get_user_gamification_stats', { p_user_id: userId });

        if (error) {
            throw new Error(error.message);
        }

        return data;
    } catch (error) {
        console.error('🛡️ [Gamification Service] getUserGamificationStats failed:', error);
        throw error;
    }
};

/**
 * Canjea una recompensa
 * @param {string} userId - ID del usuario
 * @param {string} rewardId - ID de la recompensa
 * @returns {Promise<Object>} Resultado del canje
 */
export const redeemReward = async (userId, rewardId) => {
    try {
        // Obtener datos de la recompensa
        const { data: reward, error: rewardError } = await supabase
            .from('rewards')
            .select('*')
            .eq('id', rewardId)
            .eq('is_active', true)
            .single();

        if (rewardError) {
            throw new Error('Recompensa no encontrada o no disponible');
        }

        // Verificar disponibilidad
        if (reward.availability > 0) {
            const { count } = await supabase
                .from('reward_redemptions')
                .select('*', { count: 'exact' })
                .eq('reward_id', rewardId)
                .eq('status', 'approved');

            if (count >= reward.availability) {
                throw new Error('Recompensa agotada');
            }
        }

        // Verificar puntos suficientes
        const balance = await getEcoPointsBalance(userId);
        if (balance.available_points < reward.cost_points) {
            throw new Error('Puntos insuficientes');
        }

        // Verificar requisitos
        if (reward.requirements) {
            const stats = await getUserGamificationStats(userId);
            
            if (reward.requirements.min_level && stats.current_level < reward.requirements.min_level) {
                throw new Error(`Nivel mínimo requerido: ${reward.requirements.min_level}`);
            }
            
            if (reward.requirements.min_streak && stats.current_streaks?.[0]?.current < reward.requirements.min_streak) {
                throw new Error(`Racha mínima requerida: ${reward.requirements.min_streak} días`);
            }
        }

        // Crear redención
        const { data: redemption, error: redemptionError } = await supabase
            .from('reward_redemptions')
            .insert({
                user_id: userId,
                reward_id: rewardId,
                points_spent: reward.cost_points,
                status: 'pending',
                metadata: {
                    reward_name: reward.name,
                    reward_type: reward.type,
                    reward_value: reward.value
                }
            })
            .select('*')
            .single();

        if (redemptionError) {
            throw new Error('Error al crear redención');
        }

        // Deducir puntos
        await addEcoPoints(
            userId,
            -reward.cost_points,
            'reward_redemption',
            redemption.id,
            `Canje: ${reward.name}`,
            { reward_type: reward.type, reward_value: reward.value }
        );

        return {
            success: true,
            redemption,
            reward
        };
    } catch (error) {
        console.error('🛡️ [Gamification Service] redeemReward failed:', error);
        throw error;
    }
};

/**
 * Obtiene recompensas disponibles
 * @param {Object} filters - Filtros opcionales
 * @returns {Promise<Array>} Lista de recompensas
 */
export const getAvailableRewards = async (filters = {}) => {
    try {
        let query = supabase
            .from('rewards')
            .select('*')
            .eq('is_active', true)
            .order('cost_points', { ascending: true });

        if (filters.type) {
            query = query.eq('type', filters.type);
        }

        if (filters.maxCost) {
            query = query.lte('cost_points', filters.maxCost);
        }

        const { data, error } = await query;

        if (error) {
            throw new Error(error.message);
        }

        return data || [];
    } catch (error) {
        console.error('🛡️ [Gamification Service] getAvailableRewards failed:', error);
        throw error;
    }
};

/**
 * Obtiene historial de redenciones de un usuario
 * @param {string} userId - ID del usuario
 * @param {Object} options - Opciones de paginación
 * @returns {Promise<Object>} Historial de redenciones
 */
export const getRedemptionHistory = async (
    userId,
    { limit = 20, offset = 0, status } = {}
) => {
    try {
        let query = supabase
            .from('reward_redemptions')
            .select(`
                *,
                rewards (
                    name,
                    type,
                    image_url,
                    metadata
                )
            `)
            .eq('user_id', userId)
            .order('redeemed_at', { ascending: false });

        if (status) {
            query = query.eq('status', status);
        }

        const { data, error, count } = await query.range(offset, offset + limit - 1);

        if (error) {
            throw new Error(error.message);
        }

        return {
            redemptions: data || [],
            pagination: {
                limit,
                offset,
                total: count || 0,
                hasMore: (offset + limit) < (count || 0)
            }
        };
    } catch (error) {
        console.error('🛡️ [Gamification Service] getRedemptionHistory failed:', error);
        throw error;
    }
};

/**
 * Funciones de conveniencia para eventos específicos
 */

export const awardRideCompleted = async (userId, rideData) => {
    // Puntos base por completar viaje
    const basePoints = 10;
    
    // Bonus por distancia (1 punto por cada 10km)
    const distanceBonus = Math.floor((rideData.distance || 0) / 10);
    
    // Bonus por pasajeros (5 puntos por pasajero)
    const passengerBonus = (rideData.passengerCount || 0) * 5;
    
    // Bonus por CO2 ahorrado (2 puntos por cada kg)
    const co2Bonus = Math.floor((rideData.co2Saved || 0) * 2);
    
    const totalPoints = basePoints + distanceBonus + passengerBonus + co2Bonus;
    
    return addEcoPoints(
        userId,
        totalPoints,
        'ride_completed',
        rideData.rideId,
        `Viaje completado: ${rideData.origin} → ${rideData.destination}`,
        {
            distance: rideData.distance,
            passenger_count: rideData.passengerCount,
            co2_saved: rideData.co2Saved,
            base_points: basePoints,
            distance_bonus: distanceBonus,
            passenger_bonus: passengerBonus,
            co2_bonus: co2Bonus
        }
    );
};

export const awardReviewSubmitted = async (userId, reviewData) => {
    const basePoints = 10;
    
    // Bonus por review detallada (+5 puntos si tiene comentario)
    const detailBonus = reviewData.comment && reviewData.comment.length > 50 ? 5 : 0;
    
    const totalPoints = basePoints + detailBonus;
    
    return addEcoPoints(
        userId,
        totalPoints,
        'review_submitted',
        reviewData.reviewId,
        'Valoración enviada',
        {
            rating: reviewData.rating,
            has_comment: !!reviewData.comment,
            comment_length: reviewData.comment?.length || 0,
            detail_bonus: detailBonus
        }
    );
};

export const awardBadgeEarned = async (userId, badgeData) => {
    const pointsByLevel = {
        1: 25,
        2: 50,
        3: 100,
        4: 200,
        5: 500
    };
    
    const points = pointsByLevel[badgeData.level] || 25;
    
    return addEcoPoints(
        userId,
        points,
        'badge_earned',
        badgeData.badgeId,
        `Badge obtenido: ${badgeData.badgeName}`,
        {
            badge_type: badgeData.badgeType,
            badge_level: badgeData.level,
            points_by_level: pointsByLevel
        }
    );
};

export const awardStreakMilestone = async (userId, streakData) => {
    const pointsByDays = {
        7: 50,
        30: 200,
        100: 500,
        365: 2000
    };
    
    const points = pointsByDays[streakData.days] || 10;
    
    return addEcoPoints(
        userId,
        points,
        'streak_milestone',
        null,
        `Racha de ${streakData.days} días`,
        {
            streak_type: streakData.type,
            days: streakData.days,
            points_by_days: pointsByDays
        }
    );
};

export const awardChallengeCompleted = async (userId, challengeData) => {
    return addEcoPoints(
        userId,
        challengeData.rewardPoints,
        'challenge_completed',
        challengeData.challengeId,
        `Desafío completado: ${challengeData.name}`,
        {
            challenge_name: challengeData.name,
            challenge_type: challengeData.type,
            difficulty: challengeData.difficulty
        }
    );
};

export const awardReferralBonus = async (userId, referralData) => {
    const points = 100; // Puntos fijos por referido
    
    return addEcoPoints(
        userId,
        points,
        'referral_bonus',
        referralData.referralId,
        `Bono por referido: ${referralData.referredUserName}`,
        {
            referred_user_id: referralData.referredUserId,
            referred_user_name: referralData.referredUserName
        }
    );
};

export const awardDailyLogin = async (userId) => {
    // Verificar si ya recibió puntos hoy
    const today = new Date().toISOString().split('T')[0];
    
    const { data: existingPoints } = await supabase
        .from('ecopoints_transactions')
        .select('id')
        .eq('user_id', userId)
        .eq('source_type', 'daily_login')
        .gte('created_at', `${today}T00:00:00Z`)
        .lt('created_at', `${today}T23:59:59Z`)
        .limit(1);
    
    if (existingPoints && existingPoints.length > 0) {
        return { alreadyAwarded: true };
    }
    
    return addEcoPoints(
        userId,
        5,
        'daily_login',
        null,
        'Login diario',
        { login_date: today }
    );
};

/**
 * Suscripción a actualizaciones de gamificación en tiempo real
 * @param {string} userId - ID del usuario
 * @param {Function} callback - Función callback para actualizaciones
 * @returns {Object} Suscripción de Supabase
 */
export const subscribeToGamificationUpdates = (userId, callback) => {
    const channels = [
        // Actualizaciones de EcoPoints
        supabase
            .channel(`ecopoints:${userId}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'ecopoints_transactions',
                    filter: `user_id=eq.${userId}`
                },
                (payload) => callback({ type: 'ecopoints', data: payload.new })
            ),
        
        // Actualizaciones de nivel
        supabase
            .channel(`levels:${userId}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'user_levels',
                    filter: `user_id=eq.${userId}`
                },
                (payload) => callback({ type: 'level', data: payload.new })
            ),
        
        // Actualizaciones de desafíos
        supabase
            .channel(`challenges:${userId}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'user_challenge_progress',
                    filter: `user_id=eq.${userId}`
                },
                (payload) => callback({ type: 'challenge', data: payload.new })
            ),
        
        // Actualizaciones de rachas
        supabase
            .channel(`streaks:${userId}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'user_streaks',
                    filter: `user_id=eq.${userId}`
                },
                (payload) => callback({ type: 'streak', data: payload.new })
            )
    ];

    return channels;
};

/**
 * Cancela suscripción a actualizaciones de gamificación
 * @param {Array} channels - Canales de Supabase a cancelar
 */
export const unsubscribeFromGamificationUpdates = (channels) => {
    channels.forEach(channel => {
        if (channel) {
            supabase.removeChannel(channel);
        }
    });
};
