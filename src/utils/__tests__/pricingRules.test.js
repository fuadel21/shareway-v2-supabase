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
        // 15-50km: 0.216€/km
        // +50km: 0.15€/km without an upper distance tier

        it('should return correct price for the first tier (3km)', () => {
            expect(calculateSuggestedPrice(3)).toBe("0.90");
        });

        it('should return correct price inside the second tier (10km)', () => {
            // (15 * 0.30) is not reached; 10 * 0.30 = 3.00
            expect(calculateSuggestedPrice(10)).toBe("3.00");
        });

        it('should apply the unlimited 0.15 rate after 50km (100km)', () => {
            // 4.50 + 7.56 + 7.50 = 19.56
            expect(calculateSuggestedPrice(100)).toBe("19.56");
        });

        it('should keep the 0.15 rate through 200km', () => {
            expect(calculateSuggestedPrice(200)).toBe("34.56");
        });

        it('should keep the 0.15 rate through 400km', () => {
            expect(calculateSuggestedPrice(400)).toBe("64.56");
        });

        it('should keep the 0.15 rate through 500km', () => {
            expect(calculateSuggestedPrice(500)).toBe("79.56");
        });

        it('should keep the 0.15 rate with no upper distance tier', () => {
            expect(calculateSuggestedPrice(1500)).toBe("229.56");
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
            const suggested = 19.56;

            const result = validateRidePrice(suggested, distance);
            expect(result.valid).toBe(true);
        });

        it('should allow tiny rounding difference (0.05)', () => {
            const distance = 100;
            const price = 19.61;
            
            const result = validateRidePrice(price, distance);
            expect(result.valid).toBe(true);
        });

        it('should REJECT prices higher than suggested', () => {
            const distance = 100; // Sugerido 19.56
            const price = 19.66; // +0.10 (fuera de margen)

            const result = validateRidePrice(price, distance);
            
            expect(result.valid).toBe(false);
            expect(result.error).toBe('Precio superior al sugerido');
            expect(result.maxPrice).toBe(19.56);
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
                ridePrice: 19.56,
                rideDistanceKm: 100,
                passengerDistanceKm: 100,
                detourDistanceKm: 0,
                numSeats: 2,
            })).toMatchObject({
                total: 39.12,
                pricePerSeat: 19.56,
                supplement: 0,
            });
        });

        it('adds the pickup supplement per seat after the 3km threshold', () => {
            expect(calculateBookingTotal({
                ridePrice: 19.56,
                rideDistanceKm: 100,
                passengerDistanceKm: 100,
                detourDistanceKm: 3.01,
                numSeats: 2,
            })).toMatchObject({
                total: 42.12,
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
