import { describe, it, expect } from 'vitest';
import { validateRidePrice, calculateSuggestedPrice, PRICING_CONSTANTS } from '../pricingRules';

describe('Pricing Rules (Pure Logic)', () => {

    describe('calculateSuggestedPrice', () => {
        it('should return correct suggested price for 100km', () => {
            const distance = 100;
            const expected = (100 * 0.18).toFixed(2); // 18.00
            expect(calculateSuggestedPrice(distance)).toBe(expected);
        });

        it('should return 0.00 for invalid distance', () => {
            expect(calculateSuggestedPrice(0)).toBe("0.00");
            expect(calculateSuggestedPrice(-10)).toBe("0.00");
        });
    });

    describe('validateRidePrice', () => {
        it('should allow valid prices below max rate', () => {
            // Given: A distance of 100km (Max allowed ~60€)
            const distance = 100;
            const price = 20;

            // When: Validating a reasonable price
            const result = validateRidePrice(price, distance);

            // Then: It should be valid
            expect(result.valid).toBe(true);
        });

        it('should reject prices exceeding max rate', () => {
            // Given: A distance of 100km
            const distance = 100;
            // And: An excessive price (Max allowed is 60€)
            const price = 61;

            // When: Validating the price
            const result = validateRidePrice(price, distance);

            // Then: It should be rejected with specific details
            expect(result.valid).toBe(false);
            expect(result.error).toBe('Precio excesivo detectado');
            expect(result.maxPrice).toBe(60.00);
        });

        it('should reject negative prices', () => {
            // Given/When
            const result = validateRidePrice(-5, 100);

            // Then
            expect(result.valid).toBe(false);
            expect(result.error).toBe('Precio inválido');
        });

        it('should handle zero distance gracefully', () => {
            // Given/When
            const result = validateRidePrice(10, 0);

            // Then
            expect(result.valid).toBe(false);
            expect(result.error).toBe('Distancia inválida');
        });
    });
});
