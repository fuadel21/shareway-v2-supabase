/**
 * Setup file para Vitest.
 * Configura matchers DOM, timeouts y aislamiento básico entre pruebas.
 */

import '@testing-library/jest-dom/vitest';
import { beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';

beforeAll(() => {
    console.log('🧪 Test environment ready');
});

beforeEach(() => {
    vi.clearAllMocks();
});

afterEach(() => {
    vi.clearAllMocks();
});

afterAll(() => {
    console.log('🧹 Cleaning up test environment');
});

vi.setConfig({
    testTimeout: 10000,
    hookTimeout: 5000,
});

const originalError = console.error;
console.error = (...args) => {
    const filtered = args.filter((arg) =>
        !arg?.includes?.('No autenticado') &&
        !arg?.includes?.('TEST') &&
        !arg?.includes?.('RPC Error')
    );

    if (filtered.length > 0) {
        originalError(...filtered);
    }
};
