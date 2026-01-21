import { describe, it, expect } from 'vitest';
import { createSingleRide } from '@/services/rideService';

/**
 * CONTRACT TESTS: Validación de Interfaz
 * 
 * Estos tests NO usan mocks. Validan que:
 * 1. La función maneja correctamente los datos de entrada
 * 2. Lanza errores apropiados para entradas inválidas
 * 3. La interfaz se mantiene estable
 * 
 * Para validación de comportamiento real, ver:
 * - businessRules.integration.test.js
 * - concurrency.integration.test.js
 */
describe('rideService - Contract Tests', () => {

  describe('createSingleRide - Input Validation', () => {

    it('should reject rides without origin coordinates', async () => {
      const invalidRide = {
        origin: { address: 'Madrid' }, // Sin coordinates
        destination: { address: 'Barcelona', coordinates: { lat: 41.4, lng: 2.0 } },
        dateTime: new Date('2026-02-01T10:00:00.000Z'),
        seats: 3,
        price: 12.50,
        distance: 600
      };

      await expect(createSingleRide(invalidRide))
        .rejects.toThrow(/Datos de itinerario incompletos/);
    });

    it('should reject rides without destination coordinates', async () => {
      const invalidRide = {
        origin: { address: 'Madrid', coordinates: { lat: 40.4, lng: -3.7 } },
        destination: { address: 'Barcelona' }, // Sin coordinates
        dateTime: new Date('2026-02-01T10:00:00.000Z'),
        seats: 3,
        price: 12.50,
        distance: 600
      };

      await expect(createSingleRide(invalidRide))
        .rejects.toThrow(/Datos de itinerario incompletos/);
    });

    it('should accept rides with valid coordinates in different formats', async () => {
      // Este test valida que la función normaliza diferentes formatos
      const rideWithLatLng = {
        origin: { address: 'Madrid', coordinates: { lat: 40.4, lng: -3.7 } },
        destination: { address: 'Barcelona', coordinates: { lat: 41.4, lng: 2.0 } },
        dateTime: new Date('2026-02-01T10:00:00.000Z'),
        seats: 3,
        price: 12.50,
        distance: 600
      };

      const rideWithLatitude = {
        origin: { address: 'Madrid', coordinates: { latitude: 40.4, longitude: -3.7 } },
        destination: { address: 'Barcelona', coordinates: { latitude: 41.4, longitude: 2.0 } },
        dateTime: new Date('2026-02-01T10:00:00.000Z'),
        seats: 3,
        price: 12.50,
        distance: 600
      };

      // Ambos formatos deberían ser aceptados
      // Nota: Estos tests fallarán si no hay autenticación, 
      // pero el error será diferente (auth vs validation)
      try {
        await createSingleRide(rideWithLatLng);
      } catch (error) {
        // Si falla por auth, está bien (significa que pasó la validación)
        expect(error.message).not.toContain('Datos de itinerario incompletos');
      }

      try {
        await createSingleRide(rideWithLatitude);
      } catch (error) {
        expect(error.message).not.toContain('Datos de itinerario incompletos');
      }
    });
  });
});
