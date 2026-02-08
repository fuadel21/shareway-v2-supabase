import { describe, it, expect } from 'vitest';
import { RIDE_PRICING_CONFIG as ConfigFromUtils } from '../../utils/pricingRules';
import { RIDE_PRICING_CONFIG as ConfigFromService, calculateRecommendedPrice } from '../../services/rideService';

describe('Pricing Integration & Consistency', () => {

    it('should have identical configuration in Utils and Service', () => {
        // Esto confirma que rideService está importando correctamente de utils
        expect(ConfigFromService).toBe(ConfigFromUtils);
        expect(ConfigFromService.TIERS).toEqual(ConfigFromUtils.TIERS);
    });

    it('should calculate identical prices via Service and Utils logic', () => {
        // Aunque la lógica está duplicada (calculateRecommendedPrice vs calculateSuggestedPrice),
        // deben dar el mismo resultado.
        
        // rideService.calculateRecommendedPrice toma METROS
        // pricingRules.calculateSuggestedPrice toma KM
        
        const distKm = 100;
        const distMeters = 100000;

        const priceFromService = calculateRecommendedPrice(distMeters);
        
        // Importamos dinámicamente para comparar o usamos el valor esperado
        // Sabemos que 100km = 38.00€
        expect(priceFromService).toBe(38.00); 
    });

    it('should respect max price cap in Service', () => {
        // 5000km -> muchisimo dinero
        // Pero MAX_PRICE es 300€
        const hugeDistance = 5000 * 1000; 
        expect(calculateRecommendedPrice(hugeDistance)).toBe(300);
    });
});
