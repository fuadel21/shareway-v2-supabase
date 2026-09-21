import { describe, it, expect } from 'vitest';
import {
    calculateBookingTotal,
    calculateSuggestedPrice,
    validateRidePrice,
} from '../pricingRules';

describe('Pricing Rules (Pure Logic) - Tramos Acumulativos', () => {

    describe('calculateSuggestedPrice', () => {
        // Tramos canónicos:
        // 0-15km: 0.30€/km
        // 15-100km: 0.22€/km
        // +100km: 0.15€/km without an upper distance tier

        it('should return correct price for the first tier (3km)', () => {
            expect(calculateSuggestedPrice(3)).toBe("0.90");
        });

        it('should return correct price inside the second tier (10km)', () => {
            // (15 * 0.30) is not reached; 10 * 0.30 = 3.00
            expect(calculateSuggestedPrice(10)).toBe("3.00");
        });

        it('should apply the 0.22 rate through 100km', () => {
            // 4.50 + 85 * 0.22 = 23.20
            expect(calculateSuggestedPrice(100)).toBe("23.20");
        });

        it('should apply the unlimited 0.15 rate after 100km (200km)', () => {
            expect(calculateSuggestedPrice(200)).toBe("38.20");
        });

        it('should keep the 0.15 rate through 400km', () => {
            expect(calculateSuggestedPrice(400)).toBe("68.20");
        });

        it('should keep the 0.15 rate through 500km', () => {
            expect(calculateSuggestedPrice(500)).toBe("83.20");
        });

        it('should keep the 0.15 rate with no upper distance tier', () => {
            expect(calculateSuggestedPrice(1500)).toBe("233.20");
        });

        it('should return 0.00 for invalid distance', () => {
            expect(calculateSuggestedPrice(0)).toBe("0.00");
            expect(calculateSuggestedPrice(-10)).toBe("0.00");
        });
    });

    describe('validateRidePrice', () => {
        // Regla: No se puede subir el precio sugerido (margen 0.05€)
        // Regla: Sí se puede bajar el precio
        
        it('should allow prices lower than suggested', () => {
            const distance = 100;
            const price = 10.00; // Más barato

            const result = validateRidePrice(price, distance);
            expect(result.valid).toBe(true);
        });

        it('should allow exact suggested price', () => {
            const distance = 100;
            const suggested = 23.20;

            const result = validateRidePrice(suggested, distance);
            expect(result.valid).toBe(true);
        });

        it('should allow tiny rounding difference (0.05)', () => {
            const distance = 100;
            const price = 23.25;
            
            const result = validateRidePrice(price, distance);
            expect(result.valid).toBe(true);
        });

        it('should REJECT prices higher than suggested', () => {
            const distance = 100; // Sugerido 23.20
            const price = 23.30; // +0.10 (fuera de margen)

            const result = validateRidePrice(price, distance);
            
            expect(result.valid).toBe(false);
            expect(result.error).toBe('Precio superior al sugerido');
            expect(result.maxPrice).toBe(23.20);
        });

        it('should reject negative prices', () => {
            const result = validateRidePrice(-5, 100);
            expect(result.valid).toBe(false);
            expect(result.error).toBe('Precio inválido');
        });
    });

    describe('calculateBookingTotal', () => {
        it('scales the server quote preview by requested seats', () => {
            expect(calculateBookingTotal({
                ridePrice: 23.20,
                rideDistanceKm: 100,
                passengerDistanceKm: 100,
                detourDistanceKm: 0,
                numSeats: 2,
            })).toMatchObject({
                total: 46.40,
                pricePerSeat: 23.20,
                supplement: 0,
            });
        });

        it('adds the pickup supplement per seat after the 3km threshold', () => {
            expect(calculateBookingTotal({
                ridePrice: 23.20,
                rideDistanceKm: 100,
                passengerDistanceKm: 100,
                detourDistanceKm: 3.01,
                numSeats: 2,
            })).toMatchObject({
                total: 49.40,
                supplement: 1.50,
            });
        });

        it('never drops below the 0.50 EUR per-seat floor', () => {
            expect(calculateBookingTotal({
                ridePrice: 0.50,
                rideDistanceKm: 500,
                passengerDistanceKm: 0.5,
                detourDistanceKm: 0,
                numSeats: 3,
            }).total).toBe(1.50);
        });
    });
});
