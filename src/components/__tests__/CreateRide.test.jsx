import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import CreateRide from '../CreateRide';

/**
 * COMPONENT SMOKE TESTS: CreateRide
 * 
 * Objetivo: Validar que el componente renderiza sin errores
 * NO validamos lógica de negocio (eso va en integration/E2E tests)
 * 
 * Para validación de flujos completos, ver:
 * - e2e/ride-creation.spec.ts
 */

// Mocks mínimos necesarios para renderizado
vi.mock('react-router-dom', () => ({
  useOutletContext: () => ({
    profile: {
      id: 'user-1',
      first_name: 'Test',
      last_name: 'User',
      verification: { status: 'verified' }
    }
  }),
  useNavigate: () => vi.fn(),
  useLocation: () => ({ state: null })
}));

vi.mock('../AddressAutocomplete', () => ({
  default: ({ label, onSelect }) => (
    <div data-testid={`autocomplete-${label}`}>
      <input placeholder={label} />
    </div>
  )
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn()
  }
}));

describe('CreateRide - Smoke Tests', () => {

  it('should render without crashing', () => {
    render(<CreateRide />);
    expect(screen.getByText(/Publicar/i)).toBeInTheDocument();
  });

  it('should show form for verified users', () => {
    render(<CreateRide />);

    // Verificar que los campos principales están presentes
    expect(screen.getByPlaceholderText(/Punto de origen/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Punto de llegada/i)).toBeInTheDocument();
  });

  it('should have a submit button', () => {
    render(<CreateRide />);

    const submitButton = screen.getByText(/CONTINUAR/i);
    expect(submitButton).toBeInTheDocument();
  });
});
