import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import Dashboard from '../Dashboard';

const navigate = vi.fn();

vi.mock('react-router-dom', () => {
  // Stable references: the real router context does not change between renders.
  const context = { user: { id: 'u1' }, profile: { id: 'u1', total_co2_saved: 3 } };
  return { useOutletContext: () => context, useNavigate: () => navigate };
});

vi.mock('react-i18next', () => {
  const t = (k) => k;
  const i18n = { language: 'es' };
  const value = { t, i18n };
  return { useTranslation: () => value };
});

vi.mock('../MapComponent', () => ({ default: () => <div data-testid="map" /> }));
vi.mock('../AddressAutocomplete', () => ({
  default: ({ label }) => <input placeholder={label} />,
}));
vi.mock('../DraggableSheet', () => ({ DraggableSheet: ({ children }) => <div>{children}</div> }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), message: vi.fn(), success: vi.fn() } }));
vi.mock('@/services/rideService', () => ({ getAvailableRides: vi.fn().mockResolvedValue([]) }));
vi.mock('@/hooks/useRegisteredUserCount.js', () => ({
  useRegisteredUserCount: () => ({ registeredUsers: 1234, countError: false }),
}));
vi.mock('../../lib/supabase', () => {
  const query = {
    select: () => query,
    eq: () => query,
    gte: () => Promise.resolve({ data: [] }),
  };
  return {
    supabase: {
      from: () => query,
      channel: () => {
        const channel = { on: () => channel, subscribe: () => channel };
        return channel;
      },
      removeChannel: vi.fn(),
      rpc: () => Promise.resolve({ data: null, error: null }),
    },
  };
});

describe('Dashboard redesign', () => {
  beforeEach(() => {
    navigate.mockClear();
    window.innerWidth = 400;
  });

  it('collapses the mobile search bar and expands it on tap', async () => {
    render(<Dashboard />);
    const toggle = await screen.findByRole('button', { name: 'Buscar viaje' });
    // Only the desktop sidebar panel renders the search form while the mobile bar is collapsed.
    const formButtons = () => screen.getAllByRole('button', { name: 'Buscar viajes' }).length;
    const collapsed = formButtons();

    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: /Cerrar búsqueda/i })).toBeTruthy();
    expect(formButtons()).toBe(collapsed + 1);

    fireEvent.click(screen.getByRole('button', { name: /Cerrar búsqueda/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Buscar viaje' })).toBeTruthy());
  });

  it('shows floating Ofrecer plaza / Pedir plaza buttons that navigate', async () => {
    render(<Dashboard />);
    fireEvent.click(await screen.findByRole('button', { name: /Ofrecer plaza/i }));
    expect(navigate).toHaveBeenCalledWith('/publish');
    fireEvent.click(screen.getByRole('button', { name: /Pedir plaza/i }));
    expect(navigate).toHaveBeenCalledWith('/request', expect.anything());
  });

  it('shows the floating registered users counter', async () => {
    render(<Dashboard />);
    const badge = await screen.findByTestId('registered-users-badge');
    expect(badge.textContent.replace(/\D/g, '')).toBe('1234');
    expect(badge.textContent).toMatch(/usuarios registrados/);
  });
});
