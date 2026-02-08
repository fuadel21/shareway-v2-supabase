import { describe, it, expect } from 'vitest';
import { validateRidePrice, calculateSuggestedPrice } from '../pricingRules';

describe('Pricing Rules (Pure Logic) - Tramos Acumulativos', () => {

    describe('calculateSuggestedPrice', () => {
        // Tramos actuales:
        // 0-3km: 1.00€/km
        // 3-10km: 0.50€/km
        // 10-100km: 0.35€/km
        // 100-400km: 0.20€/km
        // +400km: 0.15€/km

        it('should return correct price for 0-3km tier (3km)', () => {
            // 3 * 1.00 = 3.00
            expect(calculateSuggestedPrice(3)).toBe("3.00");
        });

        it('should return correct price for 3-10km tier (10km)', () => {
            // (3 * 1.00) + (7 * 0.50) = 3.00 + 3.50 = 6.50
            expect(calculateSuggestedPrice(10)).toBe("6.50");
        });

        it('should return correct price for 10-100km tier (100km)', () => {
            // (3 * 1.00) + (7 * 0.50) + (90 * 0.35) 
            // 3 + 3.5 + 31.5 = 38.00
            expect(calculateSuggestedPrice(100)).toBe("38.00");
        });

        it('should return correct price for 100-400km tier (200km)', () => {
            // Base 100km = 38.00
            // + 100km * 0.20 = 20.00
            // Total = 58.00
            expect(calculateSuggestedPrice(200)).toBe("58.00");
        });

        it('should return correct price for 100-400km tier limit (400km)', () => {
            // Base 100km = 38.00
            // + 300km * 0.20 = 60.00
            // Total = 98.00
            expect(calculateSuggestedPrice(400)).toBe("98.00");
        });

        it('should return correct price for +400km tier (500km)', () => {
            // Base 400km = 98.00
            // + 100km * 0.15 = 15.00
            // Total = 113.00
            expect(calculateSuggestedPrice(500)).toBe("113.00");
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
            const suggested = 38.00; // Según tests anteriores
            const price = 20.00; // Más barato

            const result = validateRidePrice(price, distance);
            expect(result.valid).toBe(true);
        });

        it('should allow exact suggested price', () => {
            const distance = 100;
            const suggested = 38.00;
            
            const result = validateRidePrice(suggested, distance);
            expect(result.valid).toBe(true);
        });

        it('should allow tiny rounding difference (0.05)', () => {
            const distance = 100;
            const price = 38.05;
            
            const result = validateRidePrice(price, distance);
            expect(result.valid).toBe(true);
        });

        it('should REJECT prices higher than suggested', () => {
            const distance = 100; // Sugerido 38.00
            const price = 38.10; // +0.10 (fuera de margen)

            const result = validateRidePrice(price, distance);
            
            expect(result.valid).toBe(false);
            expect(result.error).toBe('Precio superior al sugerido');
            expect(result.maxPrice).toBe(38.00);
        });

        it('should reject negative prices', () => {
            const result = validateRidePrice(-5, 100);
            expect(result.valid).toBe(false);
            expect(result.error).toBe('Precio inválido');
        });
    });
});
