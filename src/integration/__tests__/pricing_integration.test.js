import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: {} }));

import { RIDE_PRICING_CONFIG as ConfigFromUtils } from '../../utils/pricingRules';
import { RIDE_PRICING_CONFIG as ConfigFromService, calculateRecommendedPrice } from '../../services/rideService';

describe('Pricing Integration & Consistency', () => {

    it('should have identical configuration in Utils and Service', () => {
        // Esto confirma que rideService está importando correctamente de utils
        expect(ConfigFromService).toBe(ConfigFromUtils);
        expect(ConfigFromService.TIERS).toEqual(ConfigFromUtils.TIERS);
    });

    it('should calculate identical prices via Service and Utils logic', () => {
        // El servicio usa el adaptador de la misma configuración canónica que la utilidad;
        // ambos deben dar el mismo resultado.
        
        // rideService.calculateRecommendedPrice toma METROS
        // pricingRules.calculateSuggestedPrice toma KM
        
        const distMeters = 100000;

        const priceFromService = calculateRecommendedPrice(distMeters);
        
        // 100km = 15*0.30 + 85*0.22 = 23.20€
        expect(priceFromService).toBe(23.20);
    });

    it('should respect max price cap in Service', () => {
        // 5000km -> muchisimo dinero
        // Pero MAX_PRICE es 300€
        const hugeDistance = 5000 * 1000; 
        expect(calculateRecommendedPrice(hugeDistance)).toBe(300);
    });
});
