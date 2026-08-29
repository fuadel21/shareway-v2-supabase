import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import RideDetails from '../RideDetails';
import * as rpc from '../../lib/supabaseRPC';
import * as rideService from '../../services/rideService';

// --- MOCKS DE INFRAESTRUCTURA ---
vi.mock('../../lib/supabaseRPC', () => ({
  getRideDetailsSecure: vi.fn(),
  getRideStartReadiness: vi.fn().mockResolvedValue({ success: true, data: { ready: true, unresolved_count: 0 } }),
  getMyRidePin: vi.fn().mockResolvedValue({ success: true, data: { pin: '8899' } }),
  startRide: vi.fn(),
  verifyPassenger: vi.fn(),
  handlePassengerNoShow: vi.fn(),
  getOrCreateChat: vi.fn(),
}));

vi.mock('../../services/rideService', () => ({
  cancelRide: vi.fn(),
  cancelBooking: vi.fn()
}));

// Mock de Outlet Context (Usuario actual)
const mockUser = { id: 'user-driver-123', email: 'driver@test.com' };
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useOutletContext: () => ({ user: mockUser }),
    useParams: () => ({ id: 'ride-abc' })
  };
});

// Mock de MapComponent para evitar errores de Leaflet
vi.mock('../MapComponent', () => ({
  default: () => <div data-testid="mock-map">Map</div>
}));

// --- DATOS DE PRUEBA ---
const mockRideData = {
  id: 'ride-abc',
  driver_id: 'user-driver-123', // Mismo que mockUser.id
  driver_name: 'DRIVER ELITE',
  driver_photo: null,
  driver_rating: 4.9,
  driver_trip_count: 156,
  driver_verified: true,
  driver_vehicle: { brand: 'Tesla', model: 'Model 3', plate: '1234ABC' },
  origin: { name: 'Madrid' },
  destination: { name: 'Valencia' },
  departure_time: new Date(Date.now() + 3600000).toISOString(),
  price: 25.50,
  status: 'scheduled',
  seats_available: 3,
  passengers: []
};

describe('AUDIT: Tarjetas y Flujos de Viaje', () => {

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('AUDIT CONDUCTOR: Debe mostrar controles de gestión y datos del vehículo si el usuario es el conductor', async () => {
    rpc.getRideDetailsSecure.mockResolvedValue({
      success: true,
      data: { success: true, data: mockRideData }
    });

    render(
      <MemoryRouter initialEntries={['/ride/ride-abc']}>
        <RideDetails />
      </MemoryRouter>
    );

    // 1. Verificar Tarjeta Conductor (Info Vehículo)
    await waitFor(() => {
      expect(screen.getByText(/TESLA MODEL 3/i)).toBeInTheDocument();
      expect(screen.getByText(/Control del Conductor/i)).toBeInTheDocument();
    });

    // 2. Verificar Botones de Gestión
    expect(screen.getByText(/Iniciar Viaje/i)).toBeInTheDocument();
    expect(screen.getByText(/Cancelar mi oferta de viaje/i)).toBeInTheDocument();
  });

  it('AUDIT PASAJERO: Debe mostrar el PIN de abordaje si el usuario es un pasajero confirmado', async () => {
    const mockPassengerUser = { id: 'user-pax-456' };
    // Cambiamos el mock de user para este test
    vi.spyOn(require('react-router-dom'), 'useOutletContext').mockReturnValue({ user: mockPassengerUser });

    const rideWithPassenger = {
      ...mockRideData,
      driver_id: 'other-driver',
      passengers: [{
        id: 'user-pax-456',
        displayName: 'Test Passenger',
        status: 'confirmed',
        pin: '8899'
      }]
    };

    rpc.getRideDetailsSecure.mockResolvedValue({
      success: true,
      data: { success: true, data: rideWithPassenger }
    });

    render(
      <MemoryRouter initialEntries={['/ride/ride-abc']}>
        <RideDetails />
      </MemoryRouter>
    );

    // 1. Verificar que NO salen botones de conductor
    await waitFor(() => {
      expect(screen.queryByText(/Control del Conductor/i)).not.toBeInTheDocument();
    });

    // 2. Verificar PIN de abordaje
    expect(screen.getByText(/Código de Abordaje/i)).toBeInTheDocument();
    expect(screen.getByText('8899')).toBeInTheDocument();
    expect(screen.getByText(/Plaza Reservada/i)).toBeInTheDocument();
  });

  it('AUDIT FLUJO RESERVA: Debe abrir el modal de pago al intentar reservar', async () => {
    const mockGuestUser = { id: 'guest-789' };
    vi.spyOn(require('react-router-dom'), 'useOutletContext').mockReturnValue({ user: mockGuestUser });

    rpc.getRideDetailsSecure.mockResolvedValue({
      success: true,
      data: { success: true, data: mockRideData }
    });

    render(
      <MemoryRouter initialEntries={['/ride/ride-abc']}>
        <RideDetails />
      </MemoryRouter>
    );

    await waitFor(() => {
      const reserveBtn = screen.getByText(/Reservar Plaza/i);
      fireEvent.click(reserveBtn);
    });

    // El modal de BookingPaymentModal debería activarse (verificamos texto del modal)
    // Nota: Como BookingPaymentModal es un componente complejo, verificamos su presencia indirecta
    expect(screen.getByText(/Detalles del Pago/i || /Resumen de la Reserva/i)).toBeInTheDocument();
  });

  it('AUDIT CANCELACIÓN: Debe llamar al servicio de cancelación al confirmar', async () => {
    rpc.getRideDetailsSecure.mockResolvedValue({
      success: true,
      data: { success: true, data: mockRideData }
    });
    rideService.cancelRide.mockResolvedValue({ success: true });

    render(
      <MemoryRouter initialEntries={['/ride/ride-abc']}>
        <RideDetails />
      </MemoryRouter>
    );

    await waitFor(() => {
      const cancelBtn = screen.getByText(/Cancelar mi oferta de viaje/i);
      fireEvent.click(cancelBtn);
    });

    // Abrir AlertDialog y confirmar
    const confirmBtn = screen.getByText(/Sí, cancelar/i);
    fireEvent.click(confirmBtn);

    expect(rideService.cancelRide).toHaveBeenCalledWith('ride-abc');
  });
});
