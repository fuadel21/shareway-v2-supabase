import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import RideManagement from '../RideManagement';

const navigate = vi.fn();

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('@/lib/supabaseRPC', () => ({
  getOrCreateChat: vi.fn(async () => ({
    success: true,
    data: { chatId: 'chat-99' },
  })),
}));

vi.mock('@/services/rideService', () => ({
  RIDE_RULES: {
    MIN_ADVANCE_MINUTES: 20,
    MAX_PRICE: 300,
    MIN_PRICE: 0.5,
    MAX_SEATS: 8,
    MIN_SEATS: 1,
  },
  acceptPassenger: vi.fn(),
  cancelRide: vi.fn(),
  completeRide: vi.fn(),
  rejectPassenger: vi.fn(),
  startRide: vi.fn(),
  updateRide: vi.fn(),
  verifyPassenger: vi.fn(),
}));

vi.mock('../PinVerificationDialog', () => ({
  default: () => null,
}));

const { getOrCreateChat } = await import('@/lib/supabaseRPC');

const baseRide = {
  id: 'ride-123',
  status: 'scheduled',
  departure_time: new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString(),
  seats_total: 3,
  price: 12,
  details: 'Punto de encuentro en la estación',
  is_women_only: false,
  destination: { lat: 40.4, lng: -3.7, address: 'Madrid' },
  passengers: [
    {
      id: 'pax-1',
      displayName: 'Ana',
      status: 'pending',
      photo_url: '',
    },
    {
      id: 'pax-2',
      displayName: 'Luis',
      status: 'confirmed',
      photo_url: '',
    },
  ],
};

describe('RideManagement', () => {
  beforeEach(() => {
    navigate.mockReset();
    getOrCreateChat.mockClear();
  });

  it('shows the scheduled editor and pending requests when embedded', () => {
    render(<RideManagement ride={baseRide} onRefresh={vi.fn()} embedded />);

    expect(screen.getByText(/Edita horario, plazas y precio/i)).toBeInTheDocument();
    expect(screen.getByText(/Solicitudes por Aprobar/i)).toBeInTheDocument();
    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(screen.queryByText(/INICIAR VIAJE/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Cancelar viaje programado/i)).not.toBeInTheDocument();
  });

  it('opens the ride chat selector from the header button', () => {
    render(<RideManagement ride={baseRide} onRefresh={vi.fn()} embedded />);

    fireEvent.click(screen.getByRole('button', { name: /Abrir conversaciones del viaje/i }));
    expect(navigate).toHaveBeenCalledWith('/rides/ride-123/chats');
  });

  it('opens a private chat using the real chat id', async () => {
    render(<RideManagement ride={baseRide} onRefresh={vi.fn()} embedded />);

    fireEvent.click(screen.getByRole('button', { name: /Abrir chat con Ana/i }));

    await waitFor(() => {
      expect(getOrCreateChat).toHaveBeenCalledWith('pax-1', 'ride-123');
      expect(navigate).toHaveBeenCalledWith('/rides/ride-123/chat/chat-99');
    });
  });

  it('lets the driver open the scheduled editor', () => {
    render(<RideManagement ride={baseRide} onRefresh={vi.fn()} embedded />);

    fireEvent.click(screen.getByRole('button', { name: /Editar viaje/i }));
    expect(screen.getByText(/^Fecha$/i)).toBeInTheDocument();
    expect(screen.getByText(/^Hora$/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Guardar cambios/i })).toBeInTheDocument();
  });

  it('does not render when embedded and there is nothing to manage', () => {
    const { container } = render(
      <RideManagement
        ride={{ ...baseRide, status: 'completed', passengers: [] }}
        onRefresh={vi.fn()}
        embedded
      />
    );

    expect(container.firstChild).toBeNull();
  });
});
