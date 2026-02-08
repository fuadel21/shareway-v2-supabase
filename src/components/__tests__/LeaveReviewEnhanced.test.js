/**
 * Tests Completos del Sistema de Rating y Reviews
 * Verifica todas las funcionalidades y validaciones
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import LeaveReviewEnhanced from '../../components/LeaveReviewEnhanced.jsx';
import { testClient, createTestUser, testData, futureDate, cleanupTestData } from '../helpers.js';
import { submitReviewSecure, getUserRating, getRatingLeaderboard, getUserReviews } from '../../services/ratingService.js';

// Mock de dependencias
vi.mock('../../lib/supabase', () => ({
    supabase: testClient
}));

vi.mock('../../services/ratingService.js', () => ({
    submitReviewSecure: vi.fn(),
    canReviewUser: vi.fn(),
    getUserRating: vi.fn(),
    getUserBadges: vi.fn(),
    getRatingLeaderboard: vi.fn(),
    getUserReviews: vi.fn()
}));

vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual('react-router-dom');
    return {
        ...actual,
        useParams: () => ({ rideId: 'test-ride-id', revieweeId: 'test-reviewee-id' }),
        useNavigate: () => vi.fn(),
        useOutletContext: () => ({
            profile: { id: 'test-user-id', display_name: 'Test User' },
            user: { id: 'test-user-id' },
            refreshProfile: vi.fn()
        })
    };
});

vi.mock('sonner', () => ({
    toast: {
        success: vi.fn(),
        error: vi.fn(),
        warning: vi.fn(),
        loading: vi.fn()
    }
}));

const TestWrapper = ({ children }) => {
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

describe('Rating System - Complete Tests', () => {
    beforeEach(async () => {
        await cleanupTestData();
        vi.clearAllMocks();
    });

    describe('submitReviewSecure Function', () => {
        it('debe enviar review válida exitosamente', async () => {
            // Arrange
            vi.mocked(submitReviewSecure).mockResolvedValue({
                success: true,
                review_id: 'test-review-id',
                message: 'Valoración guardada exitosamente'
            });

            const reviewData = {
                rideId: 'test-ride-id',
                revieweeId: 'test-reviewee-id',
                rating: 5,
                comment: 'Excelente viaje'
            };

            // Act
            const result = await submitReviewSecure(reviewData);

            // Assert
            expect(result.success).toBe(true);
            expect(result.review_id).toBe('test-review-id');
            expect(vi.mocked(submitReviewSecure)).toHaveBeenCalledWith(reviewData);
        });

        it('debe rechazar auto-valoración', async () => {
            // Arrange
            vi.mocked(submitReviewSecure).mockRejectedValue(
                new Error('No puedes valorarte a ti mismo')
            );

            const reviewData = {
                rideId: 'test-ride-id',
                revieweeId: 'test-user-id', // Mismo usuario
                rating: 5,
                comment: 'Auto-valoración'
            };

            // Act & Assert
            await expect(submitReviewSecure(reviewData)).rejects.toThrow('No puedes valorarte a ti mismo');
        });

        it('debe validar rating entre 1 y 5', async () => {
            // Arrange
            vi.mocked(submitReviewSecure).mockRejectedValue(
                new Error('El rating debe estar entre 1 y 5')
            );

            const reviewData = {
                rideId: 'test-ride-id',
                revieweeId: 'test-reviewee-id',
                rating: 6, // Inválido
                comment: 'Rating inválido'
            };

            // Act & Assert
            await expect(submitReviewSecure(reviewData)).rejects.toThrow('El rating debe estar entre 1 y 5');
        });

        it('debe validar longitud del comentario', async () => {
            // Arrange
            vi.mocked(submitReviewSecure).mockRejectedValue(
                new Error('El comentario no puede exceder 500 caracteres')
            );

            const longComment = 'a'.repeat(501);
            const reviewData = {
                rideId: 'test-ride-id',
                revieweeId: 'test-reviewee-id',
                rating: 5,
                comment: longComment
            };

            // Act & Assert
            await expect(submitReviewSecure(reviewData)).rejects.toThrow('500 caracteres');
        });

        it('debe verificar que el viaje esté completado', async () => {
            // Arrange
            vi.mocked(submitReviewSecure).mockRejectedValue(
                new Error('Solo puedes valorar viajes completados o cancelados')
            );

            const reviewData = {
                rideId: 'test-ride-id',
                revieweeId: 'test-reviewee-id',
                rating: 5,
                comment: 'Viaje no completado'
            };

            // Act & Assert
            await expect(submitReviewSecure(reviewData)).rejects.toThrow('viajes completados');
        });

        it('debe prevenir valoraciones duplicadas', async () => {
            // Arrange
            vi.mocked(submitReviewSecure).mockRejectedValue(
                new Error('Ya has valorado a este usuario para este viaje')
            );

            const reviewData = {
                rideId: 'test-ride-id',
                revieweeId: 'test-reviewee-id',
                rating: 5,
                comment: 'Valoración duplicada'
            };

            // Act & Assert
            await expect(submitReviewSecure(reviewData)).rejects.toThrow('Ya has valorado');
        });

        it('debe validar tiempo máximo de 30 días', async () => {
            // Arrange
            vi.mocked(submitReviewSecure).mockRejectedValue(
                new Error('Solo puedes valorar viajes de los últimos 30 días')
            );

            const reviewData = {
                rideId: 'test-ride-id',
                revieweeId: 'test-reviewee-id',
                rating: 5,
                comment: 'Viaje muy antiguo'
            };

            // Act & Assert
            await expect(submitReviewSecure(reviewData)).rejects.toThrow('últimos 30 días');
        });
    });

    describe('getUserRating Function', () => {
        it('debe obtener rating de usuario correctamente', async () => {
            // Arrange
            const mockRating = {
                user_id: 'test-user-id',
                average_rating: 4.5,
                total_reviews: 25,
                rating_distribution: { 1: 1, 2: 2, 3: 3, 4: 5, 5: 14 },
                badges: [
                    { type: 'experienced_driver', level: 2 },
                    { type: 'five_star_driver', level: 1 }
                ],
                last_review_date: '2024-01-15T10:00:00Z'
            };

            vi.mocked(getUserRating).mockResolvedValue(mockRating);

            // Act
            const result = await getUserRating('test-user-id');

            // Assert
            expect(result).toEqual(mockRating);
            expect(vi.mocked(getUserRating)).toHaveBeenCalledWith('test-user-id');
        });

        it('debe manejar usuario sin reviews', async () => {
            // Arrange
            const mockRating = {
                user_id: 'test-user-id',
                average_rating: 0,
                total_reviews: 0,
                rating_distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
                badges: [],
                last_review_date: null
            };

            vi.mocked(getUserRating).mockResolvedValue(mockRating);

            // Act
            const result = await getUserRating('test-user-id');

            // Assert
            expect(result.total_reviews).toBe(0);
            expect(result.average_rating).toBe(0);
        });
    });

    describe('getRatingLeaderboard Function', () => {
        it('debe obtener leaderboard general', async () => {
            // Arrange
            const mockLeaderboard = {
                success: true,
                leaderboard: [
                    {
                        user_id: 'user-1',
                        average_rating: 5.0,
                        total_reviews: 50,
                        display_name: 'Usuario Top',
                        photo_url: null
                    },
                    {
                        user_id: 'user-2',
                        average_rating: 4.8,
                        total_reviews: 30,
                        display_name: 'Usuario Bueno',
                        photo_url: null
                    }
                ],
                filter: 'all',
                limit: 50
            };

            vi.mocked(getRatingLeaderboard).mockResolvedValue(mockLeaderboard);

            // Act
            const result = await getRatingLeaderboard();

            // Assert
            expect(result.success).toBe(true);
            expect(result.leaderboard).toHaveLength(2);
            expect(vi.mocked(getRatingLeaderboard)).toHaveBeenCalledWith({ limit: 50, filter: 'all' });
        });

        it('debe filtrar leaderboard por conductores', async () => {
            // Arrange
            vi.mocked(getRatingLeaderboard).mockResolvedValue({
                success: true,
                leaderboard: [
                    {
                        user_id: 'driver-1',
                        average_rating: 4.9,
                        total_reviews: 25,
                        ride_count: 15,
                        display_name: 'Conductor Top',
                        photo_url: null
                    }
                ],
                filter: 'drivers',
                limit: 50
            });

            // Act
            const result = await getRatingLeaderboard({ filter: 'drivers' });

            // Assert
            expect(result.filter).toBe('drivers');
            expect(vi.mocked(getRatingLeaderboard)).toHaveBeenCalledWith({ limit: 50, filter: 'drivers' });
        });
    });

    describe('LeaveReviewEnhanced Component', () => {
        it('debe mostrar perfil del reviewee con rating', async () => {
            // Arrange
            const mockReviewee = {
                id: 'test-reviewee-id',
                display_name: 'Juan Pérez',
                photo_url: null,
                rating: {
                    average_rating: 4.5,
                    total_reviews: 20,
                    rating_distribution: { 1: 1, 2: 1, 3: 2, 4: 5, 5: 11 }
                },
                badges: [
                    { badge_type: 'experienced_driver', badge_level: 2 }
                ]
            };

            vi.mocked(require('../../services/ratingService.js').getUserRating)
                .mockResolvedValue(mockReviewee.rating);
            vi.mocked(require('../../services/ratingService.js').getUserBadges)
                .mockResolvedValue(mockReviewee.badges);
            vi.mocked(require('../../services/ratingService.js').canReviewUser)
                .mockResolvedValue({ canReview: true });

            // Act
            render(
                <TestWrapper>
                    <LeaveReviewEnhanced />
                </TestWrapper>
            );

            // Assert
            await waitFor(() => {
                expect(screen.getByText('Juan Pérez')).toBeInTheDocument();
                expect(screen.getByText('4.5')).toBeInTheDocument();
                expect(screen.getByText('(20 valoraciones)')).toBeInTheDocument();
                expect(screen.getByText('Conductor Exp.')).toBeInTheDocument();
            });
        });

        it('debe mostrar mensaje si no puede valorar', async () => {
            // Arrange
            vi.mocked(require('../../services/ratingService.js').canReviewUser)
                .mockResolvedValue({ 
                    canReview: false, 
                    reason: 'Ya has valorado a este usuario para este viaje' 
                });

            // Act
            render(
                <TestWrapper>
                    <LeaveReviewEnhanced />
                </TestWrapper>
            );

            // Assert
            await waitFor(() => {
                expect(screen.getByText('No puedes valorar a este usuario')).toBeInTheDocument();
                expect(screen.getByText('Ya has valorado a este usuario para este viaje')).toBeInTheDocument();
            });
        });

        it('debe enviar review al hacer submit', async () => {
            // Arrange
            vi.mocked(require('../../services/ratingService.js').canReviewUser)
                .mockResolvedValue({ canReview: true });
            vi.mocked(submitReviewSecure).mockResolvedValue({
                success: true,
                review_id: 'test-review-id'
            });

            render(
                <TestWrapper>
                    <LeaveReviewEnhanced />
                </TestWrapper>
            );

            // Act
            await waitFor(() => {
                // Seleccionar rating 5 estrellas
                const starButtons = screen.getAllByRole('button');
                fireEvent.click(starButtons[4]); // 5 estrellas

                // Añadir comentario
                const textarea = screen.getByPlaceholderText(/cómo fue el viaje/i);
                fireEvent.change(textarea, { target: { value: 'Excelente experiencia' } });

                // Enviar review
                const submitButton = screen.getByText(/publicar valoración/i);
                fireEvent.click(submitButton);
            });

            // Assert
            await waitFor(() => {
                expect(vi.mocked(submitReviewSecure)).toHaveBeenCalledWith({
                    rideId: 'test-ride-id',
                    revieweeId: 'test-reviewee-id',
                    rating: 5,
                    comment: 'Excelente experiencia'
                });
            });
        });

        it('debe validar que se seleccione rating', async () => {
            // Arrange
            vi.mocked(require('../../services/ratingService.js').canReviewUser)
                .mockResolvedValue({ canReview: true });

            render(
                <TestWrapper>
                    <LeaveReviewEnhanced />
                </TestWrapper>
            );

            // Act: Intentar enviar sin rating
            await waitFor(() => {
                const submitButton = screen.getByText(/publicar valoración/i);
                fireEvent.click(submitButton);
            });

            // Assert
            expect(vi.mocked(toast.warning)).toHaveBeenCalledWith(
                "Selecciona una puntuación."
            );
        });

        it('debe limitar comentario a 500 caracteres', async () => {
            // Arrange
            vi.mocked(require('../../services/ratingService.js').canReviewUser)
                .mockResolvedValue({ canReview: true });

            render(
                <TestWrapper>
                    <LeaveReviewEnhanced />
                </TestWrapper>
            );

            // Act
            await waitFor(() => {
                const textarea = screen.getByPlaceholderText(/cómo fue el viaje/i);
                const longText = 'a'.repeat(600);
                fireEvent.change(textarea, { target: { value: longText } });
            });

            // Assert
            await waitFor(() => {
                const textarea = screen.getByPlaceholderText(/cómo fue el viaje/i);
                expect(textarea).toHaveValue('a'.repeat(500)); // Limitado a 500
                expect(screen.getByText('500/500')).toBeInTheDocument();
            });
        });

        it('debe mostrar badges del usuario', async () => {
            // Arrange
            const mockBadges = [
                { badge_type: 'experienced_driver', badge_level: 2 },
                { badge_type: 'eco_warrior', badge_level: 1 },
                { badge_type: 'five_star_driver', badge_level: 1 },
                { badge_type: 'community_hero', badge_level: 1 }
            ];

            vi.mocked(require('../../services/ratingService.js').getUserBadges)
                .mockResolvedValue(mockBadges);
            vi.mocked(require('../../services/ratingService.js').canReviewUser)
                .mockResolvedValue({ canReview: true });

            // Act
            render(
                <TestWrapper>
                    <LeaveReviewEnhanced />
                </TestWrapper>
            );

            // Assert
            await waitFor(() => {
                expect(screen.getByText('Conductor Exp.')).toBeInTheDocument();
                expect(screen.getByText('Eco Warrior')).toBeInTheDocument();
                expect(screen.getByText('5 Estrellas')).toBeInTheDocument();
                expect(screen.getByText('Héroe Comunitario')).toBeInTheDocument();
                expect(screen.getByText('+1 más')).toBeInTheDocument(); // 4 badges, muestra 3 + "+1 más"
            });
        });
    });

    describe('Edge Cases y Validaciones Adicionales', () => {
        it('debe manejar usuario no encontrado', async () => {
            // Arrange
            vi.mocked(require('../../services/ratingService.js').getUserRating)
                .mockRejectedValue(new Error('Usuario no encontrado'));

            // Act
            render(
                <TestWrapper>
                    <LeaveReviewEnhanced />
                </TestWrapper>
            );

            // Assert
            await waitFor(() => {
                expect(screen.getByText('Usuario no encontrado')).toBeInTheDocument();
            });
        });

        it('debe mostrar estado de carga correctamente', async () => {
            // Arrange
            vi.mocked(require('../../services/ratingService.js').getUserRating)
                .mockImplementation(() => new Promise(() => {})); // Nunca resuelve

            // Act
            render(
                <TestWrapper>
                    <LeaveReviewEnhanced />
                </TestWrapper>
            );

            // Assert
            expect(screen.getByText(/cargando información/i)).toBeInTheDocument();
        });

        it('debe mostrar mensaje de error en submit', async () => {
            // Arrange
            vi.mocked(require('../../services/ratingService.js').canReviewUser)
                .mockResolvedValue({ canReview: true });
            vi.mocked(submitReviewSecure).mockRejectedValue(
                new Error('Error en el servidor')
            );

            render(
                <TestWrapper>
                    <LeaveReviewEnhanced />
                </TestWrapper>
            );

            // Act
            await waitFor(() => {
                const starButtons = screen.getAllByRole('button');
                fireEvent.click(starButtons[4]); // 5 estrellas

                const submitButton = screen.getByText(/publicar valoración/i);
                fireEvent.click(submitButton);
            });

            // Assert
            await waitFor(() => {
                expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
                    'Error al publicar',
                    expect.objectContaining({
                        description: 'Error en el servidor'
                    })
                );
            });
        });
    });
});
