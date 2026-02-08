/**
 * Tests Completos del Sistema de Gamificación
 * Verifica todas las funcionalidades de puntos, niveles, desafíos y recompensas
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import GamificationDashboard from '../../components/GamificationDashboard.jsx';
import { testClient, createTestUser, cleanupTestData } from '../helpers.js';
import {
    addEcoPoints,
    getEcoPointsBalance,
    getEcoPointsHistory,
    updateStreak,
    getUserChallenges,
    updateChallengeProgress,
    getGamificationLeaderboard,
    getUserGamificationStats,
    redeemReward,
    getAvailableRewards,
    awardRideCompleted,
    awardReviewSubmitted,
    awardBadgeEarned,
    awardDailyLogin
} from '../../services/gamificationService.js';

// Mock de dependencias
vi.mock('../../lib/supabase', () => ({
    supabase: testClient
}));

vi.mock('sonner', () => ({
    toast: {
        success: vi.fn(),
        error: vi.fn(),
        info: vi.fn()
    }
}));

const TestWrapper = ({ children, userId = 'test-user-id' }) => {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false }
        }
    });

    return (
        <QueryClientProvider client={queryClient}>
            <BrowserRouter>
                {children}
            </BrowserRouter>
        </QueryClientProvider>
    );
};

describe('Gamification System - Complete Tests', () => {
    beforeEach(async () => {
        await cleanupTestData();
        vi.clearAllMocks();
    });

    describe('addEcoPoints Function', () => {
        it('debe añadir puntos positivos correctamente', async () => {
            // Arrange
            const user = await createTestUser('passengerMale');
            
            // Act
            const result = await addEcoPoints(
                user.id,
                50,
                'ride_completed',
                'test-ride-id',
                'Viaje completado'
            );

            // Assert
            expect(result.success).toBe(true);
            expect(result.new_balance).toBe(50);
            expect(result.level_up).toBe(false);
            
            // Verificar en base de datos
            const { data: transaction } = await testClient
                .from('ecopoints_transactions')
                .select('*')
                .eq('user_id', user.id)
                .single();
            
            expect(transaction.amount).toBe(50);
            expect(transaction.source_type).toBe('ride_completed');
            expect(transaction.balance_after).toBe(50);
        });

        it('debe actualizar nivel al alcanzar XP requerido', async () => {
            // Arrange
            const user = await createTestUser('passengerMale');
            
            // Añadir suficientes puntos para subir al nivel 2 (requiere 100 XP)
            const result = await addEcoPoints(
                user.id,
                150,
                'review_submitted',
                null,
                'Valoración detallada'
            );

            // Assert
            expect(result.success).toBe(true);
            expect(result.level_up).toBe(true);
            expect(result.new_level).toBe(2);
            
            // Verificar nivel actualizado
            const { data: level } = await testClient
                .from('user_levels')
                .select('*')
                .eq('user_id', user.id)
                .single();
            
            expect(level.current_level).toBe(2);
            expect(level.current_xp).toBe(150);
        });

        it('debe manejar puntos negativos para penalizaciones', async () => {
            // Arrange
            const user = await createTestUser('passengerMale');
            
            // Primero añadir puntos
            await addEcoPoints(user.id, 100, 'ride_completed');
            
            // Act: Quitar puntos por penalización
            const result = await addEcoPoints(
                user.id,
                -25,
                'penalty',
                null,
                'Penalización por cancelación'
            );

            // Assert
            expect(result.success).toBe(true);
            expect(result.new_balance).toBe(75);
            
            const balance = await getEcoPointsBalance(user.id);
            expect(balance.available_points).toBe(75);
        });

        it('debe rechazar puntos negativos para fuentes no permitidas', async () => {
            // Arrange
            const user = await createTestUser('passengerMale');
            
            // Act & Assert
            await expect(addEcoPoints(
                user.id,
                -10,
                'invalid_source'
            )).rejects.toThrow('Solo se pueden deducir puntos por penalizaciones o reembolsos');
        });

        it('debe manejar puntos con expiración', async () => {
            // Arrange
            const user = await createTestUser('passengerMale');
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24h
            
            // Act
            const result = await addEcoPoints(
                user.id,
                30,
                'challenge_completed',
                null,
                'Puntos que expiran',
                {},
                expiresAt
            );

            // Assert
            expect(result.success).toBe(true);
            
            const { data: transaction } = await testClient
                .from('ecopoints_transactions')
                .select('*')
                .eq('id', result.transaction_id)
                .single();
            
            expect(transaction.expires_at).toBe(expiresAt);
        });
    });

    describe('getEcoPointsBalance Function', () => {
        it('debe obtener balance correcto', async () => {
            // Arrange
            const user = await createTestUser('passengerMale');
            
            // Añadir puntos de diferentes fuentes
            await addEcoPoints(user.id, 100, 'ride_completed');
            await addEcoPoints(user.id, 50, 'review_submitted');
            await addEcoPoints(user.id, -20, 'penalty');

            // Act
            const balance = await getEcoPointsBalance(user.id);

            // Assert
            expect(balance.available_points).toBe(130); // 100 + 50 - 20
            expect(balance.total_earned).toBe(150); // 100 + 50
            expect(balance.total_spent).toBe(20);
        });

        it('debe calcular puntos que expiran pronto', async () => {
            // Arrange
            const user = await createTestUser('passengerMale');
            const soonExpiry = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(); // 3 días
            const laterExpiry = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(); // 10 días
            
            await addEcoPoints(user.id, 30, 'challenge_completed', null, '', {}, soonExpiry);
            await addEcoPoints(user.id, 20, 'badge_earned', null, '', {}, laterExpiry);

            // Act
            const balance = await getEcoPointsBalance(user.id);

            // Assert
            expect(balance.expiring_soon).toHaveLength(1);
            expect(balance.expiring_soon[0].amount).toBe(30);
        });

        it('debe manejar usuario sin puntos', async () => {
            // Arrange
            const user = await createTestUser('passengerMale');

            // Act
            const balance = await getEcoPointsBalance(user.id);

            // Assert
            expect(balance.available_points).toBe(0);
            expect(balance.total_earned).toBe(0);
            expect(balance.total_spent).toBe(0);
            expect(balance.expiring_soon).toEqual([]);
        });
    });

    describe('updateStreak Function', () => {
        it('debe crear nueva racha', async () => {
            // Arrange
            const user = await createTestUser('passengerMale');

            // Act
            const result = await updateStreak(user.id, 'daily_login', new Date());

            // Assert
            expect(result.success).toBe(true);
            expect(result.current_streak).toBe(1);
            expect(result.longest_streak).toBe(1);
            expect(result.is_new_day).toBe(true);
            
            const { data: streak } = await testClient
                .from('user_streaks')
                .select('*')
                .eq('user_id', user.id)
                .eq('streak_type', 'daily_login')
                .single();
            
            expect(streak.current_streak).toBe(1);
        });

        it('debe incrementar racha consecutiva', async () => {
            // Arrange
            const user = await createTestUser('passengerMale');
            const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
            const today = new Date();
            
            // Crear racha de ayer
            await updateStreak(user.id, 'daily_login', yesterday);

            // Act: Continuar hoy
            const result = await updateStreak(user.id, 'daily_login', today);

            // Assert
            expect(result.current_streak).toBe(2);
            expect(result.longest_streak).toBe(2);
            expect(result.is_new_day).toBe(true);
        });

        it('debe reiciar racha si se pierde un día', async () => {
            // Arrange
            const user = await createTestUser('passengerMale');
            const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
            
            // Crear racha de hace 2 días
            await updateStreak(user.id, 'daily_login', twoDaysAgo);

            // Act: Continuar hoy (perdió un día intermedio)
            const result = await updateStreak(user.id, 'daily_login', new Date());

            // Assert
            expect(result.current_streak).toBe(1); // Reiniciada
            expect(result.is_new_day).toBe(true);
        });

        it('debe otorgar recompensas por hitos de racha', async () => {
            // Arrange
            const user = await createTestUser('passengerMale');
            
            // Crear racha de 6 días
            for (let i = 0; i < 6; i++) {
                const date = new Date(Date.now() - (6 - i) * 24 * 60 * 60 * 1000);
                await updateStreak(user.id, 'daily_login', date);
            }

            // Act: Completar 7 días
            const result = await updateStreak(user.id, 'daily_login', new Date());

            // Assert
            expect(result.milestone_rewarded).toBe(true);
            
            // Verificar que se otorgaron 50 puntos por hito de 7 días
            const balance = await getEcoPointsBalance(user.id);
            expect(balance.available_points).toBe(50); // 50 puntos del hito
        });
    });

    describe('getUserChallenges Function', () => {
        it('debe obtener desafíos activos', async () => {
            // Arrange
            const user = await createTestUser('passengerMale');

            // Act
            const result = await getUserChallenges(user.id);

            // Assert
            expect(result.success).toBe(true);
            expect(result.challenges).toBeInstanceOf(Array);
            expect(result.total_count).toBeGreaterThan(0);
            
            // Verificar que todos los desafíos tengan las propiedades requeridas
            result.challenges.forEach(challenge => {
                expect(challenge).toHaveProperty('id');
                expect(challenge).toHaveProperty('name');
                expect(challenge).toHaveProperty('description');
                expect(challenge).toHaveProperty('type');
                expect(challenge).toHaveProperty('requirement_value');
                expect(challenge).toHaveProperty('reward_points');
                expect(challenge).toHaveProperty('current_progress');
                expect(challenge).toHaveProperty('progress_percentage');
            });
        });

        it('debe incluir desafíos completados si se solicita', async () => {
            // Arrange
            const user = await createTestUser('passengerMale');

            // Act
            const result = await getUserChallenges(user.id, true);

            // Assert
            expect(result.challenges.some(c => c.is_completed)).toBe(true);
        });

        it('debe calcular progreso correctamente', async () => {
            // Arrange
            const user = await createTestUser('passengerMale');
            
            // Simular progreso en un desafío
            await updateChallengeProgress(user.id, 'complete_rides', 3);

            // Act
            const result = await getUserChallenges(user.id);

            // Assert
            const rideChallenges = result.challenges.filter(c => c.requirement_type === 'complete_rides');
            expect(rideChallenges.length).toBeGreaterThan(0);
            
            rideChallenges.forEach(challenge => {
                expect(challenge.current_progress).toBeGreaterThanOrEqual(0);
                expect(challenge.progress_percentage).toBeGreaterThanOrEqual(0);
                expect(challenge.progress_percentage).toBeLessThanOrEqual(100);
            });
        });
    });

    describe('updateChallengeProgress Function', () => {
        it('debe actualizar progreso de desafíos coincidentes', async () => {
            // Arrange
            const user = await createTestUser('passengerMale');

            // Act
            const result = await updateChallengeProgress(
                user.id,
                'complete_rides',
                2,
                { ride_id: 'test-ride' }
            );

            // Assert
            expect(result.success).toBe(true);
            expect(result.updated_challenges).toBeInstanceOf(Array);
            expect(result.completed_count).toBeGreaterThanOrEqual(0);
            
            // Verificar que se actualizaron desafíos de tipo 'complete_rides'
            const rideChallenges = result.updated_challenges.filter(c => 
                c.requirement_type === 'complete_rides'
            );
            expect(rideChallenges.length).toBeGreaterThan(0);
        });

        it('debe completar desafío cuando se alcanza el requerimiento', async () => {
            // Arrange
            const user = await createTestUser('passengerMale');
            
            // Obtener un desafío que requiera 1 viaje
            const challenges = await getUserChallenges(user.id);
            const singleRideChallenge = challenges.challenges.find(c => 
                c.requirement_type === 'complete_rides' && c.requirement_value === 1
            );

            // Act
            const result = await updateChallengeProgress(user.id, 'complete_rides', 1);

            // Assert
            expect(result.completed_count).toBeGreaterThan(0);
            
            // Verificar que se otorgaron puntos
            const balance = await getEcoPointsBalance(user.id);
            expect(balance.available_points).toBeGreaterThan(0);
        });

        it('debe otorgar badge especial al completar desafío', async () => {
            // Arrange
            const user = await createTestUser('passengerMale');
            
            // Encontrar desafío con badge reward
            const challenges = await getUserChallenges(user.id);
            const badgeChallenge = challenges.challenges.find(c => c.reward_badge);

            if (badgeChallenge) {
                // Completar el desafío
                await updateChallengeProgress(
                    user.id,
                    badgeChallenge.requirement_type,
                    badgeChallenge.requirement_value
                );

                // Assert
                // Verificar que se otorgó el badge (a través de check_reputation_badges)
                const { data: badges } = await testClient
                    .from('reputation_badges')
                    .select('*')
                    .eq('user_id', user.id)
                    .eq('badge_type', badgeChallenge.reward_badge);

                expect(badges.length).toBeGreaterThan(0);
            }
        });
    });

    describe('getGamificationLeaderboard Function', () => {
        it('debe obtener leaderboard de puntos', async () => {
            // Arrange
            const user1 = await createTestUser('passengerMale');
            const user2 = await createTestUser('passengerFemale');
            
            // Añadir puntos a diferentes usuarios
            await addEcoPoints(user1.id, 200, 'ride_completed');
            await addEcoPoints(user2.id, 150, 'review_submitted');

            // Act
            const result = await getGamificationLeaderboard('points', 10);

            // Assert
            expect(result.success).toBe(true);
            expect(result.type).toBe('points');
            expect(result.leaderboard).toBeInstanceOf(Array);
            expect(result.leaderboard.length).toBeGreaterThan(0);
            
            // Verificar estructura de entradas
            result.leaderboard.forEach(entry => {
                expect(entry).toHaveProperty('user_id');
                expect(entry).toHaveProperty('display_name');
                expect(entry).toHaveProperty('available_points');
                expect(entry).toHaveProperty('rank');
            });
        });

        it('debe obtener leaderboard de niveles', async () => {
            // Arrange
            const user1 = await createTestUser('passengerMale');
            const user2 = await createTestUser('passengerFemale');
            
            // Subir niveles
            await addEcoPoints(user1.id, 300, 'ride_completed'); // Nivel 3
            await addEcoPoints(user2.id, 100, 'review_submitted'); // Nivel 2

            // Act
            const result = await getGamificationLeaderboard('level', 10);

            // Assert
            expect(result.type).toBe('level');
            result.leaderboard.forEach(entry => {
                expect(entry).toHaveProperty('current_level');
                expect(entry).toHaveProperty('total_xp');
            });
        });

        it('debe obtener leaderboard de rachas', async () => {
            // Arrange
            const user1 = await createTestUser('passengerMale');
            
            // Crear racha de 5 días
            for (let i = 0; i < 5; i++) {
                const date = new Date(Date.now() - (5 - i) * 24 * 60 * 60 * 1000);
                await updateStreak(user1.id, 'daily_login', date);
            }

            // Act
            const result = await getGamificationLeaderboard('streak', 10);

            // Assert
            expect(result.type).toBe('streak');
            result.leaderboard.forEach(entry => {
                expect(entry).toHaveProperty('current_streak');
                expect(entry).toHaveProperty('longest_streak');
                expect(entry).toHaveProperty('streak_type');
            });
        });

        it('debe rechazar tipo de leaderboard inválido', async () => {
            // Act & Assert
            await expect(getGamificationLeaderboard('invalid_type')).rejects.toThrow(
                'Tipo de leaderboard inválido. Use: points, level, o streak'
            );
        });
    });

    describe('getUserGamificationStats Function', () => {
        it('debe obtener estadísticas completas', async () => {
            // Arrange
            const user = await createTestUser('passengerMale');
            
            // Añadir puntos y crear estadísticas
            await addEcoPoints(user.id, 100, 'ride_completed');
            await updateStreak(user.id, 'daily_login', new Date());
            await updateChallengeProgress(user.id, 'complete_rides', 2);

            // Act
            const stats = await getUserGamificationStats(user.id);

            // Assert
            expect(stats.success).toBe(true);
            expect(stats).toHaveProperty('points_balance');
            expect(stats).toHaveProperty('current_level');
            expect(stats).toHaveProperty('current_xp');
            expect(stats).toHaveProperty('total_xp');
            expect(stats).toHaveProperty('active_challenges');
            expect(stats).toHaveProperty('completed_challenges');
            expect(stats).toHaveProperty('current_streaks');
            expect(stats).toHaveProperty('recent_achievements');
            expect(stats).toHaveProperty('total_rides');
            expect(stats).toHaveProperty('total_reviews_given');
            expect(stats).toHaveProperty('total_reviews_received');
            expect(stats).toHaveProperty('total_co2_saved');
        });

        it('debe manejar usuario sin estadísticas', async () => {
            // Arrange
            const user = await createTestUser('passengerMale');

            // Act
            const stats = await getUserGamificationStats(user.id);

            // Assert
            expect(stats.current_level).toBe(1);
            expect(stats.current_xp).toBe(0);
            expect(stats.total_xp).toBe(0);
            expect(stats.total_rides).toBe(0);
        });
    });

    describe('Funciones de Conveniencia', () => {
        it('awardRideCompleted debe calcular puntos correctamente', async () => {
            // Arrange
            const user = await createTestUser('passengerMale');
            
            const rideData = {
                rideId: 'test-ride',
                origin: 'Madrid',
                destination: 'Barcelona',
                distance: 150, // 150km
                passengerCount: 2,
                co2Saved: 25 // 25kg
            };

            // Act
            await awardRideCompleted(user.id, rideData);

            // Assert
            const balance = await getEcoPointsBalance(user.id);
            
            // Cálculo esperado: 10 (base) + 15 (150/10) + 10 (2*5) + 50 (25*2) = 85 puntos
            expect(balance.available_points).toBe(85);
        });

        it('awardReviewSubmitted debe dar bonus por comentario detallado', async () => {
            // Arrange
            const user = await createTestUser('passengerMale');
            
            const reviewData = {
                reviewId: 'test-review',
                rating: 5,
                comment: 'Este es un comentario muy detallado con más de 50 caracteres para probar el bonus de puntos adicionales por proporcionar feedback valioso y constructivo.'
            };

            // Act
            await awardReviewSubmitted(user.id, reviewData);

            // Assert
            const balance = await getEcoPointsBalance(user.id);
            expect(balance.available_points).toBe(15); // 10 base + 5 bonus
        });

        it('awardBadgeEarned debe dar puntos según nivel', async () => {
            // Arrange
            const user = await createTestUser('passengerMale');
            
            const badgeData = {
                badgeId: 'test-badge',
                badgeName: 'Test Badge',
                badgeType: 'test_type',
                level: 3
            };

            // Act
            await awardBadgeEarned(user.id, badgeData);

            // Assert
            const balance = await getEcoPointsBalance(user.id);
            expect(balance.available_points).toBe(100); // 100 puntos para nivel 3
        });

        it('awardDailyLogin debe dar puntos solo una vez al día', async () => {
            // Arrange
            const user = await createTestUser('passengerMale');

            // Act: Primera vez del día
            const result1 = await awardDailyLogin(user.id);
            expect(result1.alreadyAwarded).toBe(false);

            // Act: Segunda vez del mismo día
            const result2 = await awardDailyLogin(user.id);
            expect(result2.alreadyAwarded).toBe(true);

            // Assert
            const balance = await getEcoPointsBalance(user.id);
            expect(balance.available_points).toBe(5); // Solo una vez
        });
    });

    describe('GamificationDashboard Component', () => {
        it('debe mostrar dashboard con datos del usuario', async () => {
            // Arrange
            const user = await createTestUser('passengerMale');
            
            // Añadir algunos datos
            await addEcoPoints(user.id, 150, 'ride_completed');
            await updateStreak(user.id, 'daily_login', new Date());

            // Act
            render(
                <TestWrapper userId={user.id}>
                    <GamificationDashboard userId={user.id} />
                </TestWrapper>
            );

            // Assert
            await waitFor(() => {
                expect(screen.getByText('Nivel 1')).toBeInTheDocument();
                expect(screen.getByText('150')).toBeInTheDocument(); // EcoPoints
                expect(screen.getByText('Viajes Completados')).toBeInTheDocument();
                expect(screen.getByText('Racha Actual')).toBeInTheDocument();
            });
        });

        it('debe cambiar tabs correctamente', async () => {
            // Arrange
            const user = await createTestUser('passengerMale');

            // Act
            render(
                <TestWrapper userId={user.id}>
                    <GamificationDashboard userId={user.id} />
                </TestWrapper>
            );

            // Assert
            await waitFor(() => {
                expect(screen.getByText('📊')).toBeInTheDocument();
                expect(screen.getByText('🎯')).toBeInTheDocument();
                expect(screen.getByText('🏆')).toBeInTheDocument();
                expect(screen.getByText('🎁')).toBeInTheDocument();
            });

            // Cambiar a tab de desafíos
            fireEvent.click(screen.getByText('🎯'));
            
            await waitFor(() => {
                expect(screen.getByText('Desafíos Activos')).toBeInTheDocument();
            });

            // Cambiar a leaderboard
            fireEvent.click(screen.getByText('🏆'));
            
            await waitFor(() => {
                expect(screen.getByText('Leaderboard')).toBeInTheDocument();
            });
        });

        it('debe mostrar mensaje sin datos cuando no hay desafíos', async () => {
            // Arrange
            const user = await createTestUser('passengerMale');

            // Act
            render(
                <TestWrapper userId={user.id}>
                    <GamificationDashboard userId={user.id} />
                </TestWrapper>
            );

            // Cambiar a tab de desafíos
            await waitFor(() => {
                fireEvent.click(screen.getByText('🎯'));
            });

            // Assert
            await waitFor(() => {
                expect(screen.getByText('No hay desafíos activos')).toBeInTheDocument();
            });
        });

        it('debe reclamar puntos diarios', async () => {
            // Arrange
            const user = await createTestUser('passengerMale');

            // Act
            render(
                <TestWrapper userId={user.id}>
                    <GamificationDashboard userId={user.id} />
                </TestWrapper>
            );

            // Assert
            await waitFor(() => {
                const dailyButton = screen.getByText('Diario');
                expect(dailyButton).toBeInTheDocument();
                
                fireEvent.click(dailyButton);
                
                // Verificar toast de éxito
                expect(vi.mocked(toast.success)).toHaveBeenCalledWith(
                    '¡5 EcoPoints por tu login diario!'
                );
            });
        });

        it('debe cambiar tipo de leaderboard', async () => {
            // Arrange
            const user = await createTestUser('passengerMale');

            // Act
            render(
                <TestWrapper userId={user.id}>
                    <GamificationDashboard userId={user.id} />
                </TestWrapper>
            );

            // Cambiar a tab de leaderboard
            await waitFor(() => {
                fireEvent.click(screen.getByText('🏆'));
            });

            // Cambiar tipo a nivel
            await waitFor(() => {
                fireEvent.click(screen.getByText('📈'));
            });

            // Assert
            await waitFor(() => {
                expect(screen.getByText('💰')).toBeInTheDocument();
                expect(screen.getByText('📈')).toBeInTheDocument();
                expect(screen.getByText('🔥')).toBeInTheDocument();
            });
        });
    });

    describe('Edge Cases y Error Handling', () => {
        it('debe manejar usuario no autenticado', async () => {
            // Act & Assert
            await expect(addEcoPoints(null, 10, 'test')).rejects.toThrow();
            await expect(getEcoPointsBalance(null)).rejects.toThrow();
            await expect(getUserChallenges(null)).rejects.toThrow();
        });

        it('debe validar tipo de fuente inválido', async () => {
            // Arrange
            const user = await createTestUser('passengerMale');

            // Act & Assert
            await expect(addEcoPoints(user.id, 10, 'invalid_type')).rejects.toThrow();
        });

        it('debe manejar cantidad negativa en fuentes no permitidas', async () => {
            // Arrange
            const user = await createTestUser('passengerMale');

            // Act & Assert
            await expect(addEcoPoints(user.id, -10, 'ride_completed')).rejects.toThrow();
        });

        it('debe manejar leaderboard sin datos', async () => {
            // Act
            const result = await getGamificationLeaderboard('points', 10);

            // Assert
            expect(result.success).toBe(true);
            expect(result.leaderboard).toEqual([]);
        });
    });
});
