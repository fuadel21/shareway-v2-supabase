/**
 * Helper functions para tests de componentes
 * Proporciona datos de prueba y utilidades comunes para componentes UI
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

// Mock de Supabase para tests de componentes
export const mockSupabase = {
  auth: {
    getUser: vi.fn(() => Promise.resolve({ 
      data: { user: { id: 'test-user-123' } },
      error: null 
    }))
  },
  from: vi.fn(() => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        single: vi.fn(() => Promise.resolve({ 
          data: { id: 'test-user-123', display_name: 'Test User' },
          error: null 
        })),
        then: vi.fn(() => Promise.resolve({ 
          data: [{ id: 'test-user-123', display_name: 'Test User' }],
          error: null 
        }))
      }))
    })),
    insert: vi.fn(() => ({
      select: vi.fn(() => ({
        then: vi.fn(() => Promise.resolve({ 
          data: { id: 'new-item' },
          error: null 
        }))
      }))
    })),
    update: vi.fn(() => ({
      eq: vi.fn(() => ({
        then: vi.fn(() => Promise.resolve({ 
          data: { id: 'updated-item' },
          error: null 
        }))
      }))
    })),
    delete: vi.fn(() => ({
      eq: vi.fn(() => ({
        then: vi.fn(() => Promise.resolve({ 
          data: null,
          error: null 
        }))
      }))
    })),
    rpc: vi.fn(() => Promise.resolve({ 
      data: { success: true }, 
      error: null 
    }))
  })
};

// Mock de react-router-dom
export const mockNavigate = vi.fn();
export const mockLocation = { pathname: '/dashboard', search: '', hash: '', state: null };

// Datos de prueba para componentes
export const mockComponentData = {
  user: {
    id: 'test-user-123',
    display_name: 'Test User',
    email: 'test@example.com',
    verification: { status: 'verified' },
    wallet_balance: 100.00
  },
  ride: {
    id: 'test-ride-123',
    origin: { address: 'Madrid', coordinates: { lat: 40.4168, lng: -3.7038 } },
    destination: { address: 'Barcelona', coordinates: { lat: 41.3851, lng: 2.1734 } },
    departure_time: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    seats: 4,
    price: 25.50,
    driver_id: 'test-driver-123'
  },
  request: {
    id: 'test-request-123',
    requester_id: 'test-user-123',
    origin: { address: 'Madrid', coordinates: { lat: 40.4168, lng: -3.7038 } },
    destination: { address: 'Barcelona', coordinates: { lat: 41.3851, lng: 2.1734 } },
    departure_time: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    seats_needed: 2,
    suggested_price: 20.00
  }
};

// Utilidades de renderizado
export const renderWithProviders = (component, options = {}) => {
  const Wrapper = ({ children }) => {
    return (
      <div>
        {children}
      </div>
    );
  };

  return render(component, { wrapper: Wrapper, ...options });
};

// Utilidades de interacción
export const clickButton = async (buttonText) => {
  const button = screen.getByRole('button', { name: buttonText });
  fireEvent.click(button);
  await waitFor(() => {
    expect(button).toBeDisabled();
  });
};

export const fillForm = async (formData) => {
  for (const [fieldName, value] of Object.entries(formData)) {
    const field = screen.getByLabelText(fieldName);
    fireEvent.change(field, { target: { value } });
  }
};

// Utilidades de espera
export const waitForElement = async (elementText, timeout = 5000) => {
  return await waitFor(
    () => screen.getByText(elementText),
    { timeout }
  );
};

export const waitForElementToDisappear = async (elementText, timeout = 5000) => {
  return await waitFor(
    () => {
      expect(screen.queryByText(elementText)).not.toBeInTheDocument();
    },
    { timeout }
  );
};

// Mock de notificaciones
export const mockToast = {
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn()
};

// Mock de localStorage
export const mockLocalStorage = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn()
};

// Función para limpiar mocks después de tests
export const cleanupMocks = () => {
  vi.clearAllMocks();
  localStorage.clear();
};

export default {
  mockSupabase,
  mockNavigate,
  mockLocation,
  mockComponentData,
  renderWithProviders,
  clickButton,
  fillForm,
  waitForElement,
  waitForElementToDisappear,
  mockToast,
  mockLocalStorage,
  cleanupMocks
};
