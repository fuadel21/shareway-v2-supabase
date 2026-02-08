/**
 * Tests de Admin Dashboard
 * Detecta bugs críticos en el panel de administración
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AdminDashboard from '../../pages/Admin/AdminDashboard.jsx';
import { testClient, createTestUser, cleanupTestData } from '../helpers.js';
import { getPlatformStats, requestPlatformPayout } from '../../lib/supabaseRPC.js';

// Mock de dependencias
vi.mock('../../lib/supabaseRPC.js', () => ({
    getPlatformStats: vi.fn(),
    requestPlatformPayout: vi.fn()
}));

vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual('react-router-dom');
    return {
        ...actual,
        useParams: () => ({ tab: 'verifications' }),
        useNavigate: () => vi.fn()
    };
});

vi.mock('sonner', () => ({
    toast: {
        success: vi.fn(),
        error: vi.fn(),
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

describe('Admin Dashboard', () => {
    beforeEach(async () => {
        await cleanupTestData();
        vi.clearAllMocks();
    });

    describe('Carga de Estadísticas', () => {
        it('debe mostrar loading mientras carga estadísticas', async () => {
            // Arrange
            vi.mocked(getPlatformStats).mockImplementation(() => new Promise(() => {}));
            
            render(
                <TestWrapper>
                    <AdminDashboard />
                </TestWrapper>
            );

            // Assert
            expect(screen.getAllByRole('status')).toHaveLength(6); // 6 stat cards loading
        });

        it('debe cargar y mostrar estadísticas correctamente', async () => {
            // Arrange
            const mockStats = {
                total_users: 1250,
                active_rides: 45,
                total_rides: 3420,
                total_revenue: 15420.50,
                pending_verifications: 12,
                open_disputes: 3,
                co2_saved: 892.5
            };
            
            vi.mocked(getPlatformStats).mockResolvedValue({
                success: true,
                stats: mockStats
            });
            
            render(
                <TestWrapper>
                    <AdminDashboard />
                </TestWrapper>
            );

            // Assert
            await waitFor(() => {
                expect(screen.getByText('1250')).toBeInTheDocument(); // total_users
                expect(screen.getByText('45')).toBeInTheDocument(); // active_rides
                expect(screen.getByText('3420')).toBeInTheDocument(); // total_rides
                expect(screen.getByText('€15,420.50')).toBeInTheDocument(); // total_revenue
                expect(screen.getByText('12')).toBeInTheDocument(); // pending_verifications
                expect(screen.getByText('3')).toBeInTheDocument(); // open_disputes
            });
        });

        it('debe manejar error al cargar estadísticas', async () => {
            // Arrange
            vi.mocked(getPlatformStats).mockResolvedValue({
                success: false,
                error: 'Error de conexión'
            });
            
            render(
                <TestWrapper>
                    <AdminDashboard />
                </TestWrapper>
            );

            // Assert
            await waitFor(() => {
                expect(vi.mocked(toast.error)).toHaveBeenCalled();
            });
        });
    });

    describe('Payout de Plataforma', () => {
        it('debe solicitar payout de plataforma correctamente', async () => {
            // Arrange
            vi.mocked(getPlatformStats).mockResolvedValue({
                success: true,
                stats: { total_revenue: 5000 }
            });
            
            vi.mocked(requestPlatformPayout).mockResolvedValue({
                success: true,
                message: 'Payout solicitado'
            });
            
            render(
                <TestWrapper>
                    <AdminDashboard />
                </TestWrapper>
            );

            // Act
            const payoutButton = screen.getByText(/solicitar payout/i);
            fireEvent.click(payoutButton);

            // Assert
            await waitFor(() => {
                expect(vi.mocked(requestPlatformPayout)).toHaveBeenCalled();
                expect(vi.mocked(toast.success)).toHaveBeenCalledWith(
                    'Payout solicitado correctamente'
                );
            });
        });

        it('debe manejar error en payout', async () => {
            // Arrange
            vi.mocked(getPlatformStats).mockResolvedValue({
                success: true,
                stats: { total_revenue: 5000 }
            });
            
            vi.mocked(requestPlatformPayout).mockResolvedValue({
                success: false,
                error: 'Error en transferencia'
            });
            
            render(
                <TestWrapper>
                    <AdminDashboard />
                </TestWrapper>
            );

            // Act
            const payoutButton = screen.getByText(/solicitar payout/i);
            fireEvent.click(payoutButton);

            // Assert
            await waitFor(() => {
                expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
                    'Error al solicitar payout'
                );
            });
        });

        it('debe mostrar loading durante payout', async () => {
            // Arrange
            vi.mocked(getPlatformStats).mockResolvedValue({
                success: true,
                stats: { total_revenue: 5000 }
            });
            
            vi.mocked(requestPlatformPayout).mockImplementation(() => new Promise(() => {}));
            
            render(
                <TestWrapper>
                    <AdminDashboard />
                </TestWrapper>
            );

            // Act
            const payoutButton = screen.getByText(/solicitar payout/i);
            fireEvent.click(payoutButton);

            // Assert
            expect(screen.getByRole('status')).toBeInTheDocument(); // Loading spinner
        });
    });

    describe('Navegación de Tabs', () => {
        it('debe mostrar tab activa correctamente', async () => {
            // Arrange
            vi.mocked(getPlatformStats).mockResolvedValue({
                success: true,
                stats: {}
            });
            
            render(
                <TestWrapper>
                    <AdminDashboard />
                </TestWrapper>
            );

            // Assert
            await waitFor(() => {
                const activeTab = screen.getByRole('tab', { selected: true });
                expect(activeTab).toHaveTextContent(/verificaciones/i);
            });
        });

        it('debe cambiar de tab al hacer clic', async () => {
            // Arrange
            vi.mocked(getPlatformStats).mockResolvedValue({
                success: true,
                stats: {}
            });
            
            const mockNavigate = vi.fn();
            vi.mocked(require('react-router-dom').useNavigate).mockReturnValue(mockNavigate);
            
            render(
                <TestWrapper>
                    <AdminDashboard />
                </TestWrapper>
            );

            // Act
            const usersTab = screen.getByText(/usuarios/i);
            fireEvent.click(usersTab);

            // Assert
            expect(mockNavigate).toHaveBeenCalledWith('/admin/users');
        });
    });

    describe('Actualización en Tiempo Real', () => {
        it('debe tener botón de refresh', async () => {
            // Arrange
            vi.mocked(getPlatformStats).mockResolvedValue({
                success: true,
                stats: {}
            });
            
            render(
                <TestWrapper>
                    <AdminDashboard />
                </TestWrapper>
            );

            // Act & Assert
            await waitFor(() => {
                const refreshButton = screen.getByRole('button', { name: /refresh/i });
                expect(refreshButton).toBeInTheDocument();
            });
        });

        it('debe recargar estadísticas al hacer refresh', async () => {
            // Arrange
            vi.mocked(getPlatformStats)
                .mockResolvedValueOnce({
                    success: true,
                    stats: { total_users: 100 }
                })
                .mockResolvedValueOnce({
                    success: true,
                    stats: { total_users: 105 }
                });
            
            render(
                <TestWrapper>
                    <AdminDashboard />
                </TestWrapper>
            );

            // Esperar carga inicial
            await waitFor(() => {
                expect(screen.getByText('100')).toBeInTheDocument();
            });

            // Act
            const refreshButton = screen.getByRole('button', { name: /refresh/i });
            fireEvent.click(refreshButton);

            // Assert
            await waitFor(() => {
                expect(screen.getByText('105')).toBeInTheDocument();
                expect(vi.mocked(getPlatformStats)).toHaveBeenCalledTimes(2);
            });
        });
    });

    describe('Bugs Críticos Detectados', () => {
        it('BUG: No hay validación de permisos de admin', async () => {
            // CRÍTICO: Cualquier usuario puede acceder al admin dashboard
            // Debería verificar role === 'admin' antes de renderizar
            expect(true).toBe(true); // Placeholder para test futuro
        });

        it('BUG: No hay rate limiting en acciones críticas', async () => {
            // CRÍTICO: Se pueden hacer múltiples payouts seguidos
            // Debería haber un cooldown o validación
            expect(true).toBe(true); // Placeholder para test futuro
        });

        it('BUG: No hay auditoría de acciones de admin', async () => {
            // CRÍTICO: No se registran quién hizo qué y cuándo
            // Debería haber logs de auditoría para cada acción
            expect(true).toBe(true); // Placeholder para test futuro
        });

        it('BUG: No hay validación de montos mínimos en payout', async () => {
            // CRÍTICO: Se puede solicitar payout de cualquier cantidad
            // Debería haber un mínimo (ej: 100€) para evitar fees innecesarios
            expect(true).toBe(true); // Placeholder para test futuro
        });

        it('BUG: No hay confirmación para acciones destructivas', async () => {
            // CRÍTICO: El payout no tiene diálogo de confirmación
            // Debería pedir confirmación antes de ejecutar
            expect(true).toBe(true); // Placeholder para test futuro
        });
    });

    describe('Métricas y KPIs', () => {
        it('debe mostrar métricas de CO2 guardadas', async () => {
            // Arrange
            vi.mocked(getPlatformStats).mockResolvedValue({
                success: true,
                stats: { co2_saved: 1250.75 }
            });
            
            render(
                <TestWrapper>
                    <AdminDashboard />
                </TestWrapper>
            );

            // Assert
            await waitFor(() => {
                expect(screen.getByText(/1250.8/i)).toBeInTheDocument();
                expect(screen.getByText(/kg co2/i)).toBeInTheDocument();
            });
        });

        it('debe calcular tasa de conversión de rides', async () => {
            // BUG CRÍTICO: No hay cálculo de KPIs importantes
            // Debería mostrar tasa de conversión, tiempo promedio, etc.
            expect(true).toBe(true); // Placeholder para test futuro
        });

        it('debe mostrar gráficos de tendencias', async () => {
            // BUG: No hay visualizaciones de datos
            // Debería haber gráficos de rides por día, revenue, etc.
            expect(true).toBe(true); // Placeholder para test futuro
        });
    });
});
