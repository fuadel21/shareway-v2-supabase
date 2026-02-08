/**
 * Tests de UI con Estado Real
 * Verifica que los componentes reflejen correctamente el estado del backend
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CreateRide from '../../components/CreateRide.jsx';
import RequestRideDialog from '../../components/RequestRideDialog.jsx';
import RequestDetails from '../../components/RequestDetails.jsx';
import { testClient, createTestUser, testData, futureDate, realisticDistance, fairPrice, cleanupTestData } from '../helpers.js';

// Mock de Supabase para usar test schema
vi.mock('../../lib/supabase', () => ({
    supabase: {
        ...testClient,
        channel: vi.fn(() => ({
            on: vi.fn().mockReturnThis(),
            subscribe: vi.fn().mockReturnValue({ unsubscribe: vi.fn() })
        })),
        removeChannel: vi.fn()
    }
}));

// Mock de react-router-dom params
vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual('react-router-dom');
    return {
        ...actual,
        useParams: () => ({ id: 'test-ride-id' }),
        useSearchParams: () => [new URLSearchParams(), vi.fn()]
    };
});

// Mock de useOutletContext
vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual('react-router-dom');
    return {
        ...actual,
        useOutletContext: () => ({
            profile: { id: 'test-user-id', display_name: 'Test User' },
            user: { id: 'test-user-id' }
        })
    };
});

// Mock de sonner (toast)
vi.mock('sonner', () => ({
    toast: {
        success: vi.fn(),
        error: vi.fn(),
        loading: vi.fn()
    }
}));

// Mock de Capacitor Haptics
vi.mock('@capacitor/haptics', () => ({
    Haptics: {
        impact: vi.fn()
    }
}));

// Wrapper para componentes con router y query
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

describe('UI Integration Tests', () => {
    beforeEach(async () => {
        await cleanupTestData();
        vi.clearAllMocks();
    });

    describe('CreateRide Component', () => {
        it('debe bloquear submit si no hay ruta calculada', async () => {
            // Arrange
            render(
                <TestWrapper>
                    <CreateRide open={true} onOpenChange={vi.fn()} />
                </TestWrapper>
            );

            // Act: Intentar publicar sin seleccionar origen/destino
            const publishButton = screen.getByText(/publicar viaje/i);
            fireEvent.click(publishButton);

            // Assert: Toast de error y no se publica
            await waitFor(() => {
                expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
                    'Error',
                    expect.objectContaining({
                        description: expect.stringContaining('destino')
                    })
                );
            });
        });

        it('debe clamp asientos entre 1 y 9', async () => {
            // Arrange
            render(
                <TestWrapper>
                    <CreateRide open={true} onOpenChange={vi.fn()} />
                </TestWrapper>
            );

            // Act: Intentar establecer más de 9 asientos
            const seatsButtons = screen.getAllByRole('button');
            const increaseButton = seatsButtons.find(btn => btn.textContent === '+');
            
            // Hacer clic 10 veces
            for (let i = 0; i < 10; i++) {
                fireEvent.click(increaseButton);
            }

            // Assert: Debe estar limitado a 9
            await waitFor(() => {
                const seatsDisplay = screen.getByText(/9/i);
                expect(seatsDisplay).toBeInTheDocument();
            });
        });

        it('debe mostrar advertencia si precio/km excede 1€', async () => {
            // Arrange
            render(
                <TestWrapper>
                    <CreateRide open={true} onOpenChange={vi.fn()} />
                </TestWrapper>
            );

            // Simular distancia y precio alto
            const priceInput = screen.getByPlaceholderText(/ej: 5\.00/i);
            fireEvent.change(priceInput, { target: { value: '50' } });

            // Assert: Debe mostrar advertencia de precio/km
            await waitFor(() => {
                const warning = screen.getByText(/precio por km/i);
                expect(warning).toBeInTheDocument();
                expect(warning).toHaveClass('text-red-600');
            });
        });

        it('debe limpiar datos de ruta al cambiar origen/destino', async () => {
            // Arrange
            render(
                <TestWrapper>
                    <CreateRide open={true} onOpenChange={vi.fn()} />
                </TestWrapper>
            );

            // Simular selección de origen y destino
            const originInput = screen.getByPlaceholderText(/desde/i);
            const destinationInput = screen.getByPlaceholderText(/hasta/i);
            
            fireEvent.change(originInput, { target: { value: 'Sol, Madrid' } });
            fireEvent.change(destinationInput, { target: { value: 'Plaza Mayor, Madrid' } });

            // Act: Cambiar origen
            fireEvent.change(originInput, { target: { value: '' } });

            // Assert: Los datos de ruta deben limpiarse
            await waitFor(() => {
                // El botón de publicar debe estar deshabilitado
                const publishButton = screen.getByText(/publicar viaje/i);
                expect(publishButton).toBeDisabled();
            });
        });
    });

    describe('RequestRideDialog Component', () => {
        it('debe validar fecha mínima de +5 minutos', async () => {
            // Arrange
            render(
                <TestWrapper>
                    <RequestRideDialog open={true} onOpenChange={vi.fn()} userLocation={testData.locations.sol.coordinates} />
                </TestWrapper>
            );

            // Act: Seleccionar "Más tarde" y poner hora en el pasado
            const laterOption = screen.getByText(/más tarde/i);
            fireEvent.click(laterOption);

            const timeInput = screen.getByDisplayValue('');
            fireEvent.change(timeInput, { target: { value: '00:00' } });

            const submitButton = screen.getByText(/publicar solicitud/i);
            fireEvent.click(submitButton);

            // Assert: Toast de error por fecha en pasado
            await waitFor(() => {
                expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
                    'Error',
                    expect.objectContaining({
                        description: expect.stringContaining('futuro')
                    })
                );
            });
        });

        it('debe clamp asientos entre 1 y 4', async () => {
            // Arrange
            render(
                <TestWrapper>
                    <RequestRideDialog open={true} onOpenChange={vi.fn()} userLocation={testData.locations.sol.coordinates} />
                </TestWrapper>
            );

            // Act: Intentar establecer más de 4 asientos
            const seatsButtons = screen.getAllByRole('button');
            const increaseButton = seatsButtons.find(btn => btn.textContent === '+');
            
            // Hacer clic 5 veces
            for (let i = 0; i < 5; i++) {
                fireEvent.click(increaseButton);
            }

            // Assert: Debe estar limitado a 4
            await waitFor(() => {
                const seatsDisplay = screen.getByText('4');
                expect(seatsDisplay).toBeInTheDocument();
            });
        });

        it('debe mostrar advertencia si precio/km excede 1€', async () => {
            // Arrange
            render(
                <TestWrapper>
                    <RequestRideDialog open={true} onOpenChange={vi.fn()} userLocation={testData.locations.sol.coordinates} />
                </TestWrapper>
            );

            // Simular destino lejano y precio alto
            const destinationInput = screen.getByPlaceholderText(/ej: aeropuerto/i);
            fireEvent.change(destinationInput, { target: { value: 'Aeropuerto Barajas' } });

            const priceInput = screen.getByPlaceholderText(/ej: 5\.00/i);
            fireEvent.change(priceInput, { target: { value: '100' } });

            // Assert: Debe mostrar advertencia
            await waitFor(() => {
                const warning = screen.getByText(/precio por km/i);
                expect(warning).toBeInTheDocument();
                expect(warning).toHaveClass('text-red-600');
            });
        });

        it('debe rechazar precio negativo', async () => {
            // Arrange
            render(
                <TestWrapper>
                    <RequestRideDialog open={true} onOpenChange={vi.fn()} userLocation={testData.locations.sol.coordinates} />
                </TestWrapper>
            );

            // Act: Poner precio negativo
            const priceInput = screen.getByPlaceholderText(/ej: 5\.00/i);
            fireEvent.change(priceInput, { target: { value: '-10' } });

            const submitButton = screen.getByText(/publicar solicitud/i);
            fireEvent.click(submitButton);

            // Assert: Toast de error
            await waitFor(() => {
                expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
                    'Error',
                    expect.objectContaining({
                        description: expect.stringContaining('negativo')
                    })
                );
            });
        });
    });

    describe('RequestDetails Component', () => {
        beforeEach(async () => {
            // Crear request de prueba
            const passenger = await createTestUser('passengerMale');
            const requestData = {
                origin: testData.locations.sol,
                destination: testData.locations.plazaMayor,
                dateTime: futureDate(60),
                seats: 1,
                suggestedPrice: 15
            };
            
            const requestId = await testClient
                .from('ride_requests')
                .insert({
                    ...requestData,
                    requester_id: passenger.id,
                    status: 'pending'
                })
                .select('id')
                .single();
            
            // Mock de useParams para devolver el ID real
            vi.mocked(require('react-router-dom').useParams).mockReturnValue({ id: requestId.data.id });
        });

        it('debe mostrar cuenta atrás con payment_expires_at', async () => {
            // Arrange
            const passenger = await createTestUser('passengerMale');
            const driver = await createTestUser('driverVerified');
            
            // Crear request fulfilled con payment_expires_at
            const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
            const requestData = {
                origin: testData.locations.sol,
                destination: testData.locations.plazaMayor,
                dateTime: futureDate(60),
                seats: 1,
                suggestedPrice: 15,
                status: 'fulfilled',
                matched_ride_id: 'test-ride-id',
                payment_expires_at: expiresAt.toISOString()
            };
            
            const { data: request } = await testClient
                .from('ride_requests')
                .insert({
                    ...requestData,
                    requester_id: passenger.id
                })
                .select('id')
                .single();

            vi.mocked(require('react-router-dom').useParams).mockReturnValue({ id: request.id });

            // Act
            render(
                <TestWrapper>
                    <RequestDetails />
                </TestWrapper>
            );

            // Assert: Debe mostrar cuenta atrás
            await waitFor(() => {
                const countdown = screen.getByText(/expira en/i);
                expect(countdown).toBeInTheDocument();
            });
        });

        it('debe mostrar mensaje genérico si no hay payment_expires_at', async () => {
            // Arrange: Request accepted sin payment_expires_at
            const passenger = await createTestUser('passengerMale');
            const requestData = {
                origin: testData.locations.sol,
                destination: testData.locations.plazaMayor,
                dateTime: futureDate(60),
                seats: 1,
                suggestedPrice: 15,
                status: 'accepted',
                matched_ride_id: 'test-ride-id'
                // Sin payment_expires_at
            };
            
            const { data: request } = await testClient
                .from('ride_requests')
                .insert({
                    ...requestData,
                    requester_id: passenger.id
                })
                .select('id')
                .single();

            vi.mocked(require('react-router-dom').useParams).mockReturnValue({ id: request.id });

            // Act
            render(
                <TestWrapper>
                    <RequestDetails />
                </TestWrapper>
            );

            // Assert: Debe mostrar mensaje alternativo
            await waitFor(() => {
                const message = screen.getByText(/procede al pago para confirmar plaza/i);
                expect(message).toBeInTheDocument();
            });
        });

        it('debe mostrar botón de pago solo para requests fulfilled', async () => {
            // Arrange: Request pending (sin fulfilled)
            const passenger = await createTestUser('passengerMale');
            const requestData = {
                origin: testData.locations.sol,
                destination: testData.locations.plazaMayor,
                dateTime: futureDate(60),
                seats: 1,
                suggestedPrice: 15,
                status: 'pending'
                // Sin matched_ride_id
            };
            
            const { data: request } = await testClient
                .from('ride_requests')
                .insert({
                    ...requestData,
                    requester_id: passenger.id
                })
                .select('id')
                .single();

            vi.mocked(require('react-router-dom').useParams).mockReturnValue({ id: request.id });

            // Act
            render(
                <TestWrapper>
                    <RequestDetails />
                </TestWrapper>
            );

            // Assert: No debe mostrar botón de pago
            await waitFor(() => {
                expect(screen.queryByText(/proceder al pago seguro/i)).not.toBeInTheDocument();
                expect(screen.getByText(/buscando driver/i)).toBeInTheDocument();
            });
        });

        it('debe permitir cancelar request propia', async () => {
            // Arrange
            const passenger = await createTestUser('passengerMale');
            const requestData = {
                origin: testData.locations.sol,
                destination: testData.locations.plazaMayor,
                dateTime: futureDate(60),
                seats: 1,
                suggestedPrice: 15,
                status: 'pending'
            };
            
            const { data: request } = await testClient
                .from('ride_requests')
                .insert({
                    ...requestData,
                    requester_id: passenger.id
                })
                .select('id')
                .single();

            vi.mocked(require('react-router-dom').useParams).mockReturnValue({ id: request.id });

            // Mock de window.confirm
            window.confirm = vi.fn(() => true);

            // Act
            render(
                <TestWrapper>
                    <RequestDetails />
                </TestWrapper>
            );

            const cancelButton = screen.getByText(/retirar solicitud/i);
            fireEvent.click(cancelButton);

            // Assert: Debe mostrar confirmación
            expect(window.confirm).toHaveBeenCalledWith(
                expect.stringContaining('seguro que quieres retirar')
            );
        });
    });

    describe('Error Handling en UI', () => {
        it('debe mostrar errores de backend específicos', async () => {
            // Arrange
            render(
                <TestWrapper>
                    <CreateRide open={true} onOpenChange={vi.fn()} />
                </TestWrapper>
            );

            // Mock de createSingleRide para simular error específico
            const { createSingleRide } = await import('../../services/rideService.js');
            vi.mocked(createSingleRide).mockRejectedValue(new Error('Conflicto de horario: Ya tienes un viaje en un margen de 2h'));

            // Act: Intentar crear ride
            const publishButton = screen.getByText(/publicar viaje/i);
            fireEvent.click(publishButton);

            // Assert: Debe mostrar error específico del backend
            await waitFor(() => {
                expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
                    'Error al publicar',
                    expect.objectContaining({
                        description: 'Conflicto de horario: Ya tienes un viaje en un margen de 2h'
                    })
                );
            });
        });

        it('dece mostrar estado de carga durante operaciones largas', async () => {
            // Arrange
            render(
                <TestWrapper>
                    <CreateRide open={true} onOpenChange={vi.fn()} />
                </TestWrapper>
            );

            // Mock de createSingleRide para simular operación lenta
            const { createSingleRide } = await import('../../services/rideService.js');
            let resolvePromise;
            const slowPromise = new Promise(resolve => {
                resolvePromise = resolve;
            });
            vi.mocked(createSingleRide).mockReturnValue(slowPromise);

            // Act: Iniciar publicación
            const publishButton = screen.getByText(/publicar viaje/i);
            fireEvent.click(publishButton);

            // Assert: Debe mostrar estado de carga
            expect(screen.getByRole('status', { name: /loading/i })).toBeInTheDocument();
            expect(publishButton).toBeDisabled();

            // Resolver la promesa
            resolvePromise('test-ride-id');
        });
    });
});
