/**
 * Setup file para Vitest
 * Configura el entorno de testing y limpia entre tests
 */

import { beforeAll, afterAll, beforeEach, afterEach } from 'vitest';

// Configuración global antes de todos los tests
beforeAll(async () => {
    console.log('🧪 Test environment ready');
});

// Limpieza entre cada test para asegurar aislamiento
beforeEach(async () => {
    // Limpiar mocks entre tests
    vi.clearAllMocks();
});

// Verificación final después de cada test
afterEach(async () => {
    // Limpiar mocks después de cada test
    vi.clearAllMocks();
});

// Cleanup final después de todos los tests
afterAll(async () => {
    console.log('🧹 Cleaning up test environment');
});

// Configuración de timeouts globales
import { vi } from 'vitest';

// Fake timers para tests que necesiten manipular el tiempo
vi.setConfig({
    testTimeout: 10000,
    hookTimeout: 5000,
});

// Mock de console.error para evitar ruido en tests, pero mantener errores críticos
const originalError = console.error;
console.error = (...args) => {
    // Filtrar errores esperados en tests
    const filtered = args.filter(arg => 
        !arg?.includes?.('No autenticado') && 
        !arg?.includes?.('TEST') &&
        !arg?.includes?.('RPC Error')
    );
    
    if (filtered.length > 0) {
        originalError(...filtered);
    }
};
