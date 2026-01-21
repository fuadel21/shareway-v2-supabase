import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { confirmTripAndPay, calculateRefundAmount } from '@/services/bookingService';

/**
 * CONTRACT TESTS: Validación de Lógica de Negocio Pura
 * Cumple Reglas de Calidad:
 * - Determinismo (Mock Date)
 * - Atomicidad
 * - Documentación Viva (GWT)
 */
describe('bookingService - Contract Tests', () => {

  // Configuramos una fecha base fija "AHORA"
  const NOW_STRING = '2026-06-01T12:00:00.000Z';
  const NOW = new Date(NOW_STRING);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('calculateRefundAmount - Refund Policy Logic', () => {

    const createRide = (hoursUntil) => ({
      departure_time: new Date(NOW.getTime() + hoursUntil * 3600000).toISOString(),
      price: 100
    });

    it('should refund 100% for pending requests', () => {
      // Given: A pending request
      const passengerInfo = { status: 'pending' };
      const ride = createRide(24);

      // When
      const result = calculateRefundAmount(ride, passengerInfo);

      // Then
      expect(result.amount).toBe(100);
      expect(result.percentage).toBe(100);
      expect(result.message).toContain('pendiente');
    });

    it('should refund 100% if cancelled >24h before departure', () => {
      // Given: Departure is in 48h
      const ride = createRide(48);

      // When
      const result = calculateRefundAmount(ride, null);

      // Then
      expect(result.amount).toBe(100);
      expect(result.percentage).toBe(100);
      expect(result.message).toContain('24h');
    });

    it('should refund 50% if cancelled between 2h and 24h before departure', () => {
      // Given: Departure is in 5h
      const ride = createRide(5);

      // When
      const result = calculateRefundAmount(ride, null);

      // Then
      expect(result.amount).toBe(50);
      expect(result.percentage).toBe(50);
      expect(result.message).toContain('50%');
    });

    it('should refund 0% if cancelled <2h before departure', () => {
      // Given: Departure is in 1h
      const ride = createRide(1);

      // When
      const result = calculateRefundAmount(ride, null);

      // Then
      expect(result.amount).toBe(0);
      expect(result.percentage).toBe(0);
      expect(result.message).toContain('Sin reembolso');
    });

    it('should refund 100% within 15min grace period if >3h until departure', () => {
      // Given: Departure in 4h
      const ride = createRide(4);
      // And: Booked 10 mins ago (Grace period active)
      const passengerInfo = {
        status: 'confirmed',
        booked_at: new Date(NOW.getTime() - 10 * 60000).toISOString()
      };

      // When
      const result = calculateRefundAmount(ride, passengerInfo);

      // Then
      expect(result.amount).toBe(100);
      expect(result.percentage).toBe(100);
      expect(result.message).toContain('gracia');
    });

    it('should NOT apply grace period if <3h until departure', () => {
      // Given: Departure in 2h (Grace period disabled)
      const ride = createRide(2);
      // And: Booked 10 mins ago
      const passengerInfo = {
        status: 'confirmed',
        booked_at: new Date(NOW.getTime() - 10 * 60000).toISOString()
      };

      // When
      const result = calculateRefundAmount(ride, passengerInfo);

      // Then: 50% rule applies (2h-24h window)
      expect(result.percentage).toBe(50);
    });

    it('should return 0 for invalid ride data', () => {
      // Given/When
      const result = calculateRefundAmount(null, null);

      // Then
      expect(result.amount).toBe(0);
      expect(result.percentage).toBe(0);
      expect(result.message).toContain('insuficientes');
    });
  });

  describe('confirmTripAndPay - Input Validation', () => {

    it('should reject booking without ride ID', async () => {
      // Given/When/Then
      await expect(confirmTripAndPay(null))
        .rejects.toThrow(/Falta el ID del viaje/);
    });

    it('should reject booking with empty ride ID', async () => {
      // Given/When/Then
      await expect(confirmTripAndPay(''))
        .rejects.toThrow(/Falta el ID del viaje/);
    });
  });
});
