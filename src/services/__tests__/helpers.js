/**
 * Helper functions para tests
 * Proporciona datos de prueba y utilidades comunes
 */

// Datos de prueba
export const testData = {
  validRide: {
    origin: { address: 'Madrid, Spain', coordinates: { lat: 40.4168, lng: -3.7038 } },
    destination: { address: 'Barcelona, Spain', coordinates: { lat: 41.3851, lng: 2.1734 } },
    departure_time: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    seats: 4,
    price: 25.50,
    distance: 615,
    details: 'Viaje confortable'
  },
  validRequest: {
    origin: { address: 'Madrid, Spain', coordinates: { lat: 40.4168, lng: -3.7038 } },
    destination: { address: 'Barcelona, Spain', coordinates: { lat: 41.3851, lng: 2.1734 } },
    departure_time: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    seats_needed: 2,
    suggested_price: 20.00,
    distance: 615,
    details: 'Necesito plaza'
  },
  validUser: {
    id: 'test-user-123',
    display_name: 'Test User',
    email: 'test@example.com',
    verification: { status: 'verified' },
    wallet_balance: 100.00
  }
};

// Distancias de prueba
export const realisticDistance = 615;
export const fairPrice = 25.50;
export const excessivePrice = 100.00;

// Fechas de prueba
export const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000);

// Función para limpiar datos de prueba
export const cleanupTestData = async () => {
  // Implementar limpieza si es necesario
  console.log('🧹 Test data cleaned up');
};

// Función para crear usuarios de prueba
export const createTestUser = async (userData = {}) => {
  return {
    id: `test-user-${Date.now()}`,
    display_name: userData.display_name || 'Test User',
    email: userData.email || 'test@example.com',
    verification: { status: 'verified' },
    wallet_balance: userData.wallet_balance || 100.00,
    created_at: new Date().toISOString(),
    ...userData
  };
};

// Cliente de prueba para Supabase
export const testClient = {
  from: (table) => ({
    select: (columns) => ({
      eq: (column, value) => ({
        single: () => Promise.resolve({ data: null, error: null })
      }),
      insert: (data) => ({
        select: () => ({
          then: () => Promise.resolve({ data: data, error: null })
        })
      }),
      update: (data) => ({
        eq: (column, value) => ({
          then: () => Promise.resolve({ data: data, error: null })
        })
      }),
      delete: () => ({
        then: () => Promise.resolve({ data: null, error: null })
      })
    }),
    rpc: (functionName, params) => {
      return Promise.resolve({ 
        data: { success: true }, 
        error: null 
      });
    }
  })
};

export default {
  testData,
  realisticDistance,
  fairPrice,
  excessivePrice,
  futureDate,
  cleanupTestData,
  createTestUser,
  testClient
};
