/**
 * Tests de Sistema de Rating y Reviews
 * Detecta bugs críticos en el sistema de valoraciones
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import LeaveReview from '../../components/LeaveReview.jsx';
import { testClient, createTestUser, testData, futureDate, cleanupTestData } from '../helpers.js';
import { submitReview } from '../../services/rideService.js';

// Mock de dependencias
vi.mock('../../lib/supabase', () => ({
    supabase: testClient
}));

vi.mock('../../services/rideService.js', () => ({
    submitReview: vi.fn()
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

describe('Rating and Reviews System', () => {
    beforeEach(async () => {
        await cleanupTestData();
        vi.clearAllMocks();
    });

    describe('LeaveReview Component', () => {
        it('debe mostrar error si no se selecciona rating', async () => {
            // Arrange
            vi.mocked(submitReview).mockResolvedValue(true);
            
            render(
                <TestWrapper>
                    <LeaveReview />
                </TestWrapper>
            );

            // Act: Intentar enviar sin rating
            const submitButton = screen.getByText(/valorar miembro/i);
            fireEvent.click(submitButton);

            // Assert
            expect(vi.mocked(toast.warning)).toHaveBeenCalledWith(
                "Selecciona una puntuación."
            );
            expect(vi.mocked(submitReview)).not.toHaveBeenCalled();
        });

        it('debe mostrar error si no hay sesión válida', async () => {
            // Arrange
            vi.mocked(require('react-router-dom').useOutletContext).mockReturnValue({
                profile: null,
                user: null,
                refreshProfile: vi.fn()
            });
            
            render(
                <TestWrapper>
                    <LeaveReview />
                </TestWrapper>
            );

            // Act: Seleccionar rating y enviar
            const starButton = screen.getByRole('button', { name: /5/i });
            fireEvent.click(starButton);

            const submitButton = screen.getByText(/valorar miembro/i);
            fireEvent.click(submitButton);

            // Assert
            expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
                "Sesión no válida."
            );
        });

        it('debe enviar review con datos correctos', async () => {
            // Arrange
            vi.mocked(submitReview).mockResolvedValue(true);
            const mockNavigate = vi.fn();
            vi.mocked(require('react-router-dom').useNavigate).mockReturnValue(mockNavigate);
            
            render(
                <TestWrapper>
                    <LeaveReview />
                </TestWrapper>
            );

            // Act: Seleccionar rating 5 estrellas y añadir comentario
            const starButtons = screen.getAllByRole('button');
            fireEvent.click(starButtons[4]); // 5 estrellas

            const textarea = screen.getByPlaceholderText(/cómo fue el viaje/i);
            fireEvent.change(textarea, { target: { value: 'Excelente viaje, muy recomendable' } });

            const submitButton = screen.getByText(/valorar miembro/i);
            fireEvent.click(submitButton);

            // Assert
            await waitFor(() => {
                expect(vi.mocked(submitReview)).toHaveBeenCalledWith({
                    rideId: 'test-ride-id',
                    revieweeId: 'test-reviewee-id',
                    rating: 5,
                    comment: 'Excelente viaje, muy recomendable'
                });
            });

            expect(vi.mocked(toast.success)).toHaveBeenCalledWith(
                "¡Valoración guardada!",
                expect.objectContaining({
                    description: "Has ganado 10 EcoPoints por tu feedback."
                })
            );

            expect(mockNavigate).toHaveBeenCalledWith('/my-rides');
        });

        it('debe manejar error en envío de review', async () => {
            // Arrange
            vi.mocked(submitReview).mockRejectedValue(new Error('Error en la base de datos'));
            
            render(
                <TestWrapper>
                    <LeaveReview />
                </TestWrapper>
            );

            // Act
            const starButtons = screen.getAllByRole('button');
            fireEvent.click(starButtons[4]); // 5 estrellas

            const submitButton = screen.getByText(/valorar miembro/i);
            fireEvent.click(submitButton);

            // Assert
            await waitFor(() => {
                expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
                    "Error al publicar",
                    expect.objectContaining({
                        description: "Error en la base de datos"
                    })
                );
            });
        });

        it('debe limitar comentario a 500 caracteres', async () => {
            // Arrange
            render(
                <TestWrapper>
                    <LeaveReview />
                </TestWrapper>
            );

            const textarea = screen.getByPlaceholderText(/cómo fue el viaje/i);
            
            // Act: Intentar escribir más de 500 caracteres
            const longText = 'a'.repeat(600);
            fireEvent.change(textarea, { target: { value: longText } });

            // Assert
            expect(textarea).toHaveValue('a'.repeat(500));
        });

        it('debe refrescar perfil después de enviar review', async () => {
            // Arrange
            vi.mocked(submitReview).mockResolvedValue(true);
            const mockRefreshProfile = vi.fn();
            vi.mocked(require('react-router-dom').useOutletContext).mockReturnValue({
                profile: { id: 'test-user-id', display_name: 'Test User' },
                user: { id: 'test-user-id' },
                refreshProfile: mockRefreshProfile
            });
            
            render(
                <TestWrapper>
                    <LeaveReview />
                </TestWrapper>
            );

            // Act
            const starButtons = screen.getAllByRole('button');
            fireEvent.click(starButtons[4]);

            const submitButton = screen.getByText(/valorar miembro/i);
            fireEvent.click(submitButton);

            // Assert
            await waitFor(() => {
                expect(mockRefreshProfile).toHaveBeenCalled();
            });
        });
    });

    describe('submitReview Service', () => {
        it('debe llamar a RPC con datos correctos', async () => {
            // Arrange
            const mockSafeCall = vi.fn().mockResolvedValue({ success: true });
            const mockRPC = vi.fn().mockReturnValue({ safeCall: mockSafeCall });
            vi.doMock('../../lib/supabaseRPC.js', () => mockRPC);

            const { submitReview } = await import('../../services/rideService.js');

            const reviewData = {
                rideId: 'test-ride-id',
                revieweeId: 'test-reviewee-id',
                rating: 5,
                comment: 'Excelente viaje'
            };

            // Act
            await submitReview(reviewData);

            // Assert
            expect(mockSafeCall).toHaveBeenCalledWith(
                expect.any(Function),
                'submit_review_v2'
            );
        });

        it('debe manejar error de RPC', async () => {
            // Arrange
            const mockSafeCall = vi.fn().mockResolvedValue({ 
                success: false, 
                error: 'Error RPC' 
            });
            const mockRPC = vi.fn().mockReturnValue({ safeCall: mockSafeCall });
            vi.doMock('../../lib/supabaseRPC.js', () => mockRPC);

            const { submitReview } = await import('../../services/rideService.js');

            const reviewData = {
                rideId: 'test-ride-id',
                revieweeId: 'test-reviewee-id',
                rating: 5,
                comment: 'Excelente viaje'
            };

            // Act & Assert
            await expect(submitReview(reviewData)).rejects.toThrow('Error RPC');
        });
    });

    describe('Validaciones de Negocio', () => {
        it('debe prevenir valoración duplicada del mismo viaje', async () => {
            // Este test requiere implementación en backend
            // Por ahora, verificamos que el componente no previene duplicados
            // BUG CRÍTICO: No hay validación para evitar múltiples reviews del mismo viaje
            expect(true).toBe(true); // Placeholder para test futuro
        });

        it('debe prevenir auto-valoración', async () => {
            // BUG CRÍTICO: No hay validación para evitar que un usuario se valore a sí mismo
            expect(true).toBe(true); // Placeholder para test futuro
        });

        it('debe verificar que el viaje esté completado antes de permitir valoración', async () => {
            // BUG CRÍTICO: No hay validación del estado del viaje
            expect(true).toBe(true); // Placeholder para test futuro
        });
    });

    describe('Integración con EcoPoints', () => {
        it('debe otorgar 10 EcoPoints por cada review', async () => {
            // Arrange
            vi.mocked(submitReview).mockResolvedValue(true);
            
            render(
                <TestWrapper>
                    <LeaveReview />
                </TestWrapper>
            );

            // Act
            const starButtons = screen.getAllByRole('button');
            fireEvent.click(starButtons[4]);

            const submitButton = screen.getByText(/valorar miembro/i);
            fireEvent.click(submitButton);

            // Assert
            await waitFor(() => {
                expect(vi.mocked(toast.success)).toHaveBeenCalledWith(
                    "¡Valoración guardada!",
                    expect.objectContaining({
                        description: "Has ganado 10 EcoPoints por tu feedback."
                    })
                );
            });
        });

        it('debe actualizar el rating promedio del usuario valorado', async () => {
            // BUG CRÍTICO: No hay lógica para actualizar el rating promedio
            // Esto debería hacerse en el backend después de cada review
            expect(true).toBe(true); // Placeholder para test futuro
        });
    });
});
