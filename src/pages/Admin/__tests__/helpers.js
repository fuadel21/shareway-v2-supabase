/**
 * Helper functions para tests de Admin
 * Proporciona datos de prueba y utilidades comunes para componentes Admin
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

// Mock de Supabase para tests de Admin
export const mockAdminSupabase = {
  auth: {
    getUser: vi.fn(() => Promise.resolve({ 
      data: { user: { id: 'admin-user-123', role: 'admin' } },
      error: null 
    }))
  },
  from: vi.fn(() => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        single: vi.fn(() => Promise.resolve({ 
          data: { id: 'admin-user-123', display_name: 'Admin User', role: 'admin' },
          error: null 
        })),
        then: vi.fn(() => Promise.resolve({ 
          data: [{ id: 'admin-user-123', display_name: 'Admin User', role: 'admin' }],
          error: null 
        }))
      }))
    })),
    insert: vi.fn(() => ({
      select: vi.fn(() => ({
        then: vi.fn(() => Promise.resolve({ 
          data: { id: 'new-admin-item' },
          error: null 
        }))
      }))
    })),
    update: vi.fn(() => ({
      eq: vi.fn(() => ({
        then: vi.fn(() => Promise.resolve({ 
          data: { id: 'updated-admin-item' },
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

// Mock de react-router-dom para Admin
export const mockAdminNavigate = vi.fn();
export const mockAdminLocation = { pathname: '/admin', search: '', hash: '', state: null };

// Datos de prueba para componentes Admin
export const mockAdminData = {
  admin: {
    id: 'admin-user-123',
    display_name: 'Admin User',
    email: 'admin@example.com',
    role: 'admin',
    verification: { status: 'verified' },
    wallet_balance: 1000.00
  },
  platformStats: {
    total_users: 1250,
    active_rides: 45,
    total_revenue: 15420.50,
    pending_payouts: 3250.00
  },
  user: {
    id: 'test-user-123',
    display_name: 'Test User',
    email: 'test@example.com',
    role: 'user',
    verification: { status: 'verified' },
    wallet_balance: 100.00,
    created_at: new Date().toISOString()
  },
  ride: {
    id: 'test-ride-123',
    origin: { address: 'Madrid', coordinates: { lat: 40.4168, lng: -3.7038 } },
    destination: { address: 'Barcelona', coordinates: { lat: 41.3851, lng: 2.1734 } },
    departure_time: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    seats: 4,
    price: 25.50,
    driver_id: 'test-driver-123',
    status: 'active'
  }
};

// Utilidades de renderizado para Admin
export const renderWithAdminProviders = (component, options = {}) => {
  const Wrapper = ({ children }) => {
    return (
      <div>
        {children}
      </div>
    );
  };

  return render(component, { wrapper: Wrapper, ...options });
};

// Utilidades de interacción para Admin
export const clickAdminButton = async (buttonText) => {
  const button = screen.getByRole('button', { name: buttonText });
  fireEvent.click(button);
  await waitFor(() => {
    expect(button).toBeDisabled();
  });
};

export const fillAdminForm = async (formData) => {
  for (const [fieldName, value] of Object.entries(formData)) {
    const field = screen.getByLabelText(fieldName);
    fireEvent.change(field, { target: { value } });
  }
};

// Utilidades de espera para Admin
export const waitForAdminElement = async (elementText, timeout = 5000) => {
  return await waitFor(
    () => screen.getByText(elementText),
    { timeout }
  );
};

export const waitForAdminStats = async (timeout = 5000) => {
  return await waitFor(
    () => {
      expect(screen.getByText('Total Users')).toBeInTheDocument();
      expect(screen.getByText('Active Rides')).toBeInTheDocument();
      expect(screen.getByText('Total Revenue')).toBeInTheDocument();
    },
    { timeout }
  );
};

// Mock de notificaciones para Admin
export const mockAdminToast = {
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn()
};

// Mock de localStorage para Admin
export const mockAdminLocalStorage = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn()
};

// Función para limpiar mocks de Admin después de tests
export const cleanupAdminMocks = () => {
  vi.clearAllMocks();
  localStorage.clear();
};

// Generador de datos de prueba para Admin
export const generateAdminTestData = () => {
  return {
    users: Array.from({ length: 10 }, (_, i) => ({
      id: `user-${i}`,
      display_name: `User ${i}`,
      email: `user${i}@example.com`,
      role: i === 0 ? 'admin' : 'user',
      created_at: new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString()
    })),
    rides: Array.from({ length: 5 }, (_, i) => ({
      id: `ride-${i}`,
      origin: `City ${i}`,
      destination: `City ${i + 1}`,
      price: 25.50 + i * 5,
      status: ['active', 'completed', 'cancelled'][i % 3]
    }))
  };
};

export default {
  mockAdminSupabase,
  mockAdminNavigate,
  mockAdminLocation,
  mockAdminData,
  renderWithAdminProviders,
  clickAdminButton,
  fillAdminForm,
  waitForAdminElement,
  waitForAdminStats,
  mockAdminToast,
  mockAdminLocalStorage,
  cleanupAdminMocks,
  generateAdminTestData
};
