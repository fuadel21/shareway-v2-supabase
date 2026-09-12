import { describe, it, expect } from 'vitest';
import {
    calculateBookingTotal,
    calculateSuggestedPrice,
    validateRidePrice,
} from '../pricingRules';

describe('Pricing Rules (Pure Logic) - Tramos Acumulativos', () => {

    describe('calculateSuggestedPrice', () => {
        // Tramos canónicos tras el incremento del 20%:
        // 0-15km: 0.30€/km
        // 15-50km: 0.216€/km
        // 50-200km: 0.144€/km
        // 200-500km: 0.108€/km
        // +500km: 0.084€/km

        it('should return correct price for the first tier (3km)', () => {
            expect(calculateSuggestedPrice(3)).toBe("0.90");
        });

        it('should return correct price inside the second tier (10km)', () => {
            // (15 * 0.30) is not reached; 10 * 0.30 = 3.00
            expect(calculateSuggestedPrice(10)).toBe("3.00");
        });

        it('should return correct price inside the third tier (100km)', () => {
            // 4.50 + 7.56 + 7.20 = 19.26
            expect(calculateSuggestedPrice(100)).toBe("19.26");
        });

        it('should return correct price at the third tier limit (200km)', () => {
            expect(calculateSuggestedPrice(200)).toBe("33.66");
        });

        it('should return correct price inside the fourth tier (400km)', () => {
            expect(calculateSuggestedPrice(400)).toBe("55.26");
        });

        it('should return correct price at the fourth tier limit (500km)', () => {
            expect(calculateSuggestedPrice(500)).toBe("66.06");
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
            const suggested = 19.26;

            const result = validateRidePrice(suggested, distance);
            expect(result.valid).toBe(true);
        });

        it('should allow tiny rounding difference (0.05)', () => {
            const distance = 100;
            const price = 19.31;
            
            const result = validateRidePrice(price, distance);
            expect(result.valid).toBe(true);
        });

        it('should REJECT prices higher than suggested', () => {
            const distance = 100; // Sugerido 19.26
            const price = 19.36; // +0.10 (fuera de margen)

            const result = validateRidePrice(price, distance);
            
            expect(result.valid).toBe(false);
            expect(result.error).toBe('Precio superior al sugerido');
            expect(result.maxPrice).toBe(19.26);
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
                ridePrice: 19.26,
                rideDistanceKm: 100,
                passengerDistanceKm: 100,
                detourDistanceKm: 0,
                numSeats: 2,
            })).toMatchObject({
                total: 38.52,
                pricePerSeat: 19.26,
                supplement: 0,
            });
        });

        it('adds the pickup supplement per seat after the 3km threshold', () => {
            expect(calculateBookingTotal({
                ridePrice: 19.26,
                rideDistanceKm: 100,
                passengerDistanceKm: 100,
                detourDistanceKm: 3.01,
                numSeats: 2,
            })).toMatchObject({
                total: 41.52,
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
