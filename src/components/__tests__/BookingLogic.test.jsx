import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import RideDetails from '../RideDetails';
import * as rpc from '@/lib/supabaseRPC';

// --- MOCKS DE ÉLITE ---
const MOCK_USER_ID = '00000000-0000-0000-0000-000000000456';
const MOCK_RIDE_ID = '00000000-0000-0000-0000-000000000123';
const MOCK_DRIVER_ID = '00000000-0000-0000-0000-000000000999';

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useParams: () => ({ id: MOCK_RIDE_ID }),
    useNavigate: () => vi.fn(),
    useOutletContext: () => ({
      user: { id: MOCK_USER_ID, email: 'passenger@test.com' },
      profile: { id: MOCK_USER_ID, gender: 'male' }
    }),
    useSearchParams: () => [new URLSearchParams(), vi.fn()]
  };
});

vi.mock('@/lib/supabaseRPC', () => ({
  getRideDetailsSecure: vi.fn(),
  confirmTripAndPay: vi.fn(),
  getMyRidePin: vi.fn(async () => ({ data: null }))
}));

vi.mock('@/hooks/useWallet', () => ({
  useWallet: () => ({
    wallet: { balance: 50.00 },
    loadingWallet: false,
    refreshWallet: vi.fn()
  })
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (str) => str,
    i18n: { changeLanguage: () => Promise.resolve() }
  })
}));

vi.mock('../MapComponent', () => ({
  default: () => <div data-testid="mock-map">Map</div>
}));

describe('BookingLogic (DOM Integration)', () => {
    
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('debe bloquear la reserva si el género no coincide (Escudo de Seguridad)', async () => {
        rpc.getRideDetailsSecure.mockResolvedValue({
            success: true,
            data: {
                id: MOCK_RIDE_ID,
                driver_id: MOCK_DRIVER_ID,
                origin: { address: 'Madrid' },
                destination: { address: 'Valencia' },
                price: 15.00,
                seats_available: 3,
                status: 'scheduled',
                driver_name: 'Driver Test',
                is_women_only: true
            }
        });

        render(<BrowserRouter><RideDetails /></BrowserRouter>);

        // Usamos findByTestId para manejar el estado de carga inicial
        const bookingBtn = await screen.findByTestId('booking-button');
        expect(bookingBtn.disabled).toBe(true);
        expect(screen.getByText(/solo para mujeres/i)).toBeInTheDocument();
    });

    it('debe permitir abrir el selector de pago si el viaje es abierto para todos', async () => {
        rpc.getRideDetailsSecure.mockResolvedValue({
            success: true,
            data: {
                id: MOCK_RIDE_ID,
                driver_id: MOCK_DRIVER_ID,
                origin: { address: 'Madrid' },
                destination: { address: 'Valencia' },
                price: 10.00,
                seats_available: 2,
                status: 'scheduled',
                driver_name: 'Driver Test',
                is_women_only: false
            }
        });

        render(<BrowserRouter><RideDetails /></BrowserRouter>);

        const bookingBtn = await screen.findByTestId('booking-button');
        expect(bookingBtn.disabled).toBe(false);
        
        fireEvent.click(bookingBtn);

        // Verificar que se abre el modal de pago
        await waitFor(() => {
            expect(screen.getByText(/método de pago/i)).toBeInTheDocument();
        });
    });
});
