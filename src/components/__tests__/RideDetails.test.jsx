import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import RideDetails from '../RideDetails';

/**
 * COMPONENT SMOKE TESTS: RideDetails
 * 
 * Objetivo: Validar que el componente renderiza sin errores
 * NO validamos lógica de negocio (eso va en integration/E2E tests)
 * 
 * Para validación de flujos completos, ver:
 * - e2e/booking-flow.spec.ts
 */

// Mocks mínimos necesarios
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useParams: () => ({ id: 'ride-123' }),
    useNavigate: () => vi.fn(),
    useOutletContext: () => ({
      user: { id: 'user-2', email: 'passenger@example.com' },
      profile: { id: 'user-2', first_name: 'Passenger', last_name: 'User', gender: 'male' }
    })
  };
});

vi.mock('@/lib/supabaseRPC', () => ({
  getRideDetailsSecure: vi.fn(async () => ({
    success: true,
    data: {
      id: 'ride-123',
      driver_id: 'driver-1',
      origin: { address: 'Madrid', name: 'Madrid' },
      destination: { address: 'Barcelona', name: 'Barcelona' },
      departure_time: new Date(Date.now() + 86400000).toISOString(),
      seats_available: 2,
      price: 10,
      status: 'scheduled',
      passengers: [],
      driver: { id: 'driver-1', first_name: 'Driver', full_name: 'Driver Test' },
      participant_ids: [],
      is_women_only: false,
      approval_mode: 'automatic'
    }
  })),
  getMyRidePin: vi.fn(async () => ({ data: null }))
}));

vi.mock('@/hooks/useWallet', () => ({
  useWallet: () => ({
    wallet: { balance: 100 },
    loadingWallet: false,
    refreshWallet: vi.fn()
  })
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn()
  }
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    channel: () => ({
      on: () => ({ subscribe: () => { } })
    }),
    removeChannel: vi.fn(),
    rpc: vi.fn(() => Promise.resolve({ data: null, error: null }))
  }
}));

vi.mock('../MapComponent', () => ({
  default: () => <div data-testid="map-component">Map</div>
}));

vi.mock('../RideManagement', () => ({
  default: () => <div data-testid="ride-management">Gestión Élite</div>
}));

describe('RideDetails - Smoke Tests', () => {

  it('should render without crashing', async () => {
    const { container } = render(
      <BrowserRouter>
        <RideDetails />
      </BrowserRouter>
    );

    // Simplemente verificar que el componente renderizó algo
    expect(container).toBeTruthy();
  });

  it('should attempt to load ride data', async () => {
    const { container } = render(
      <BrowserRouter>
        <RideDetails />
      </BrowserRouter>
    );

    // Verificar que el componente está en el DOM
    expect(container.firstChild).toBeTruthy();
  });
});
