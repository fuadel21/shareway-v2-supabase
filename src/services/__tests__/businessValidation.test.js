/**
 * Tests Exhaustivos para Validaciones de Negocio y Límites
 * Cobertura completa de reglas de negocio, límites, políticas y validaciones
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { supabase } from '@/lib/supabase';
import { safeCall } from '@/lib/supabaseRPC';
import { 
  validateBusinessRules,
  checkUserLimits,
  validatePricing,
  validateTiming,
  validateGeographic,
  checkUserEligibility,
  applyBusinessPolicies,
  validateCompliance,
  checkRateLimits
} from '@/services/validationService';

// Mock de Supabase
vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(),
          then: vi.fn(),
          gte: vi.fn(() => ({
            lte: vi.fn(() => ({
              count: vi.fn(() => ({
                then: vi.fn()
              }))
            }))
          })
        })),
        in: vi.fn(() => ({
          then: vi.fn()
        }))
      })),
      insert: vi.fn(() => ({
        select: vi.fn(() => ({
          then: vi.fn()
        }))
      })),
      update: vi.fn(() => ({
        eq: vi.fn(() => ({
          then: vi.fn()
        }))
      }))
    })),
    auth: {
      getUser: vi.fn()
    }
  }
}));

describe('🔍 Tests de Validaciones de Negocio y Límites', () => {
  const mockUserId = 'user-123';
  const mockDriverId = 'driver-456';
  const mockRideId = 'ride-789';

  const mockUserProfile = {
    id: mockUserId,
    display_name: 'Usuario Test',
    email: 'test@example.com',
    verification: { status: 'verified' },
    wallet_balance: 100.00,
    created_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 días ago
    total_rides: 15,
    rating: 4.8,
    gender: 'male',
    date_of_birth: '1990-01-01'
  };

  const mockRideData = {
    origin: { address: 'Madrid, Spain', coordinates: { lat: 40.4168, lng: -3.7038 } },
    destination: { address: 'Barcelona, Spain', coordinates: { lat: 41.3851, lng: 2.1734 } },
    departure_time: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    seats: 4,
    price: 25.50,
    distance: 615,
    is_women_only: false
  };

  beforeEach(() => {
    vi.clearAllMocks();
    supabase.auth.getUser.mockResolvedValue({
      data: { user: { id: mockUserId } }
    });
  });

  describe('✅ Validaciones de Reglas de Negocio (validateBusinessRules)', () => {
    it('debería validar reglas de negocio correctamente', async () => {
      const businessData = {
        userId: mockUserId,
        action: 'create_ride',
        data: mockRideData
      };

      const mockResult = {
        valid: true,
        rulesPassed: [
          'user_verified',
          'sufficient_balance',
          'valid_pricing',
          'valid_timing',
          'within_limits'
        ],
        warnings: [],
        errors: []
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await validateBusinessRules(businessData);

      expect(result.valid).toBe(true);
      expect(result.rulesPassed).toHaveLength(5);
      expect(result.errors).toHaveLength(0);
    });

    it('debería detectar violaciones de reglas de negocio', async () => {
      const businessData = {
        userId: mockUserId,
        action: 'create_ride',
        data: {
          ...mockRideData,
          price: 400.00, // Precio excesivo
          departure_time: new Date(Date.now() + 5 * 60 * 1000).toISOString() // Muy pronto
        }
      };

      const mockResult = {
        valid: false,
        rulesPassed: ['user_verified'],
        warnings: ['departure_time_soon'],
        errors: [
          'pricing_exceeds_limit',
          'price_per_km_excessive'
        ]
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await validateBusinessRules(businessData);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('pricing_exceeds_limit');
      expect(result.warnings).toContain('departure_time_soon');
    });

    it('debería aplicar reglas condicionales', async () => {
      const businessData = {
        userId: mockUserId,
        action: 'create_ride',
        data: {
          ...mockRideData,
          is_women_only: true,
          is_exclusive_community: true
        }
      };

      const mockResult = {
        valid: true,
        rulesPassed: [
          'user_verified',
          'women_only_eligible',
          'community_member',
          'valid_pricing'
        ],
        conditionalRules: {
          women_only: { passed: true, reason: 'user_is_female' },
          exclusive_community: { passed: true, reason: 'user_is_premium_member' }
        }
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await validateBusinessRules(businessData);

      expect(result.valid).toBe(true);
      expect(result.conditionalRules.women_only.passed).toBe(true);
      expect(result.conditionalRules.exclusive_community.passed).toBe(true);
    });
  });

  describe('✅ Verificación de Límites de Usuario (checkUserLimits)', () => {
    it('debería verificar límites diarios correctamente', async () => {
      const limitsData = {
        userId: mockUserId,
        action: 'create_ride',
        period: 'daily'
      };

      const mockResult = {
        withinLimits: true,
        currentUsage: {
          rides_created: 2,
          max_rides_daily: 10,
          rides_participated: 3,
          max_participations_daily: 15
        },
        remainingCapacity: {
          rides_can_create: 8,
          rides_can_participate: 12
        }
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await checkUserLimits(limitsData);

      expect(result.withinLimits).toBe(true);
      expect(result.currentUsage.rides_created).toBe(2);
      expect(result.remainingCapacity.rides_can_create).toBe(8);
    });

    it('debería detectar exceso de límites diarios', async () => {
      const limitsData = {
        userId: mockUserId,
        action: 'create_ride',
        period: 'daily'
      };

      const mockResult = {
        withinLimits: false,
        exceededLimits: [
          { type: 'rides_created', current: 10, limit: 10, exceeded: true },
          { type: 'total_distance', current: 520, limit: 500, exceeded: true }
        ],
        resetTimes: {
          daily: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString() // En 2 horas
        }
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await checkUserLimits(limitsData);

      expect(result.withinLimits).toBe(false);
      expect(result.exceededLimits).toHaveLength(2);
      expect(result.exceededLimits[0].type).toBe('rides_created');
    });

    it('debería verificar límites semanales', async () => {
      const limitsData = {
        userId: mockUserId,
        action: 'create_ride',
        period: 'weekly'
      };

      const mockResult = {
        withinLimits: true,
        currentUsage: {
          rides_created: 25,
          max_rides_weekly: 50,
          total_distance: 1250,
          max_distance_weekly: 2000
        },
        weeklyStats: {
          average_rides_per_day: 3.6,
          peak_day: 'friday',
          most_common_route: 'Madrid-Barcelona'
        }
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await checkUserLimits(limitsData);

      expect(result.withinLimits).toBe(true);
      expect(result.weeklyStats.average_rides_per_day).toBe(3.6);
    });

    it('debería verificar límites mensuales', async () => {
      const limitsData = {
        userId: mockUserId,
        action: 'create_ride',
        period: 'monthly'
      };

      const mockResult = {
        withinLimits: true,
        currentUsage: {
          rides_created: 85,
          max_rides_monthly: 200,
          total_earnings: 1250.50,
          max_earnings_monthly: 3000.00
        },
        monthlyTrends: {
          growth_rate: 15.5, // porcentaje
          retention_rate: 78.2,
          satisfaction_score: 4.6
        }
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await checkUserLimits(limitsData);

      expect(result.withinLimits).toBe(true);
      expect(result.monthlyTrends.growth_rate).toBe(15.5);
    });
  });

  describe('✅ Validación de Precios (validatePricing)', () => {
    it('debería validar precios según política de precio justo', async () => {
      const pricingData = {
        price: 25.50,
        distance: 615,
        route: 'Madrid-Barcelona',
        vehicle_type: 'standard',
        time_of_day: 'morning'
      };

      const mockResult = {
        valid: true,
        pricePerKm: 0.041, // 25.50 / 615
        withinPolicyLimits: true,
        marketRate: {
          min: 20.00,
          max: 35.00,
          average: 27.50
        },
        recommendations: {
          competitive: true,
          demand_adjusted: 28.00,
          optimal_price: 26.75
        }
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await validatePricing(pricingData);

      expect(result.valid).toBe(true);
      expect(result.pricePerKm).toBe(0.041);
      expect(result.withinPolicyLimits).toBe(true);
      expect(result.marketRate.average).toBe(27.50);
    });

    it('debería rechazar precios que exceden política', async () => {
      const pricingData = {
        price: 45.00, // Excesivo
        distance: 615,
        route: 'Madrid-Barcelona'
      };

      const mockResult = {
        valid: false,
        pricePerKm: 0.073, // Excede 0.60€/km
        violations: [
          { type: 'price_per_km_excessive', current: 0.073, limit: 0.60 },
          { type: 'above_market_rate', current: 45.00, market_max: 35.00 }
        ],
        suggestedPrice: 32.50
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await validatePricing(pricingData);

      expect(result.valid).toBe(false);
      expect(result.violations).toHaveLength(2);
      expect(result.suggestedPrice).toBe(32.50);
    });

    it('debería ajustar precios según demanda', async () => {
      const pricingData = {
        price: 25.50,
        distance: 615,
        route: 'Madrid-Barcelona',
        time_of_day: 'peak_hour', // Hora pico
        day_of_week: 'friday',
        special_event: true
      };

      const mockResult = {
        valid: true,
        basePrice: 25.50,
        demandMultiplier: 1.3, // 30% más por hora pico
        adjustedPrice: 33.15,
        demandFactors: {
          time_of_day: 1.2,
          day_of_week: 1.1,
          special_event: 1.1
        }
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await validatePricing(pricingData);

      expect(result.valid).toBe(true);
      expect(result.demandMultiplier).toBe(1.3);
      expect(result.adjustedPrice).toBe(33.15);
    });

    it('debería validar precios para vehículos premium', async () => {
      const pricingData = {
        price: 45.00,
        distance: 615,
        vehicle_type: 'premium',
        amenities: ['wifi', 'ac', 'leather_seats']
      };

      const mockResult = {
        valid: true,
        vehicleTypeMultiplier: 1.5,
        amenitiesBonus: 5.00,
        justifiedPrice: 45.00,
        premiumFeatures: {
          base_multiplier: 1.3,
          amenities_value: 5.00,
          comfort_score: 9.2
        }
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await validatePricing(pricingData);

      expect(result.valid).toBe(true);
      expect(result.vehicleTypeMultiplier).toBe(1.5);
      expect(result.justifiedPrice).toBe(45.00);
    });
  });

  describe('✅ Validación de Tiempos (validateTiming)', () => {
    it('debería validar tiempos de salida correctamente', async () => {
      const timingData = {
        departure_time: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        arrival_time: new Date(Date.now() + 26 * 60 * 60 * 1000).toISOString(),
        route_distance: 615
      };

      const mockResult = {
        valid: true,
        timeToDeparture: 24 * 60 * 60, // 24 horas en segundos
        estimatedDuration: 2 * 60 * 60, // 2 horas
        reasonableSpeed: 307.5, // km/h promedio
        withinOperatingHours: true,
        notHoliday: true
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await validateTiming(timingData);

      expect(result.valid).toBe(true);
      expect(result.timeToDeparture).toBe(24 * 60 * 60);
      expect(result.withinOperatingHours).toBe(true);
    });

    it('debería rechazar tiempos demasiado cercanos', async () => {
      const timingData = {
        departure_time: new Date(Date.now() + 5 * 60 * 1000).toISOString(), // En 5 minutos
        route_distance: 615
      };

      const mockResult = {
        valid: false,
        violations: [
          { type: 'departure_too_soon', minimum_minutes: 10, current_minutes: 5 }
        ],
        suggestedDeparture: new Date(Date.now() + 15 * 60 * 1000).toISOString()
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await validateTiming(timingData);

      expect(result.valid).toBe(false);
      expect(result.violations[0].type).toBe('departure_too_soon');
    });

    it('debería validar duración estimada realista', async () => {
      const timingData = {
        departure_time: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        arrival_time: new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString(), // 1 hora para 615km
        route_distance: 615
      };

      const mockResult = {
        valid: false,
        violations: [
          { type: 'unrealistic_duration', estimated_speed: 615, reasonable_max: 130 }
        ],
        suggestedDuration: 4.7 // horas
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await validateTiming(timingData);

      expect(result.valid).toBe(false);
      expect(result.violations[0].estimated_speed).toBe(615);
    });

    it('debería validar horarios de operación', async () => {
      const timingData = {
        departure_time: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        departure_hour: 3 // 3 AM
      };

      const mockResult = {
        valid: false,
        violations: [
          { type: 'outside_operating_hours', operating_start: 6, operating_end: 23 }
        ],
        alternativeTimes: [
          new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString(), // 7 AM
          new Date(Date.now() + 26 * 60 * 60 * 1000).toISOString()  // 8 AM
        ]
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await validateTiming(timingData);

      expect(result.valid).toBe(false);
      expect(result.violations[0].operating_start).toBe(6);
    });
  });

  describe('✅ Validaciones Geográficas (validateGeographic)', () => {
    it('debería validar coordenadas correctamente', async () => {
      const geoData = {
        origin: { lat: 40.4168, lng: -3.7038, address: 'Madrid, Spain' },
        destination: { lat: 41.3851, lng: 2.1734, address: 'Barcelona, Spain' }
      };

      const mockResult = {
        valid: true,
        coordinates: {
          origin: { valid: true, within_bounds: true },
          destination: { valid: true, within_bounds: true }
        },
        distance: {
          calculated: 615,
          reasonable: true,
          within_service_area: true
        },
        route: {
          feasible: true,
          major_roads: ['A-2', 'AP-2'],
          estimated_travel_time: 6.5 // horas
        }
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await validateGeographic(geoData);

      expect(result.valid).toBe(true);
      expect(result.distance.calculated).toBe(615);
      expect(result.route.feasible).toBe(true);
    });

    it('debería rechazar coordenadas inválidas', async () => {
      const geoData = {
        origin: { lat: 91, lng: 181 }, // Coordenadas inválidas
        destination: { lat: 41.3851, lng: 2.1734 }
      };

      const mockResult = {
        valid: false,
        violations: [
          { type: 'invalid_coordinates', point: 'origin', lat: 91, lng: 181 }
        ]
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await validateGeographic(geoData);

      expect(result.valid).toBe(false);
      expect(result.violations[0].type).toBe('invalid_coordinates');
    });

    it('debería validar distancia máxima', async () => {
      const geoData = {
        origin: { lat: 40.4168, lng: -3.7038 },
        destination: { lat: 35.6761, lng: 139.6503 }, // Tokio (muy lejos)
        distance: 10700
      };

      const mockResult = {
        valid: false,
        violations: [
          { type: 'distance_exceeds_limit', distance: 10700, max_distance: 500 }
        ]
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await validateGeographic(geoData);

      expect(result.valid).toBe(false);
      expect(result.violations[0].distance).toBe(10700);
    });

    it('debería validar área de servicio', async () => {
      const geoData = {
        origin: { lat: 40.4168, lng: -3.7038 },
        destination: { lat: 52.5200, lng: 13.4050 } // Berlín (fuera de área)
      };

      const mockResult = {
        valid: false,
        violations: [
          { type: 'outside_service_area', point: 'destination', service_area: 'Spain' }
        ],
        nearest_service_point: {
          city: 'Paris',
          distance_to_service: 1200
        }
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await validateGeographic(geoData);

      expect(result.valid).toBe(false);
      expect(result.nearest_service_point.city).toBe('Paris');
    });
  });

  describe('✅ Verificación de Elegibilidad de Usuario (checkUserEligibility)', () => {
    it('debería verificar elegibilidad completa del usuario', async () => {
      const eligibilityData = {
        userId: mockUserId,
        action: 'create_ride',
        requirements: ['verified', 'experienced_driver', 'good_rating']
      };

      const mockResult = {
        eligible: true,
        checks: {
          verified: { passed: true, verified_at: '2024-01-15' },
          experienced_driver: { passed: true, total_rides: 15, minimum: 5 },
          good_rating: { passed: true, rating: 4.8, minimum: 4.0 }
        },
        profile: {
          account_age_days: 30,
          completion_percentage: 95,
          trust_score: 8.5
        }
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await checkUserEligibility(eligibilityData);

      expect(result.eligible).toBe(true);
      expect(result.checks.verified.passed).toBe(true);
      expect(result.profile.trust_score).toBe(8.5);
    });

    it('debería detectar inelegibilidad por verificación', async () => {
      const eligibilityData = {
        userId: mockUserId,
        action: 'create_ride'
      };

      const mockResult = {
        eligible: false,
        failedChecks: [
          { type: 'not_verified', status: 'pending', documents_needed: ['id_card', 'address_proof'] }
        ],
        recommendations: [
          'Complete identity verification',
          'Upload address proof'
        ]
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await checkUserEligibility(eligibilityData);

      expect(result.eligible).toBe(false);
      expect(result.failedChecks[0].type).toBe('not_verified');
    });

    it('debería verificar elegibilidad para viajes women_only', async () => {
      const eligibilityData = {
        userId: mockUserId,
        action: 'join_women_only_ride',
        specific_requirements: ['female_gender', 'verified']
      };

      const mockResult = {
        eligible: false,
        failedChecks: [
          { type: 'gender_mismatch', required: 'female', current: 'male' }
        ],
        alternatives: [
          'Search for regular rides',
          'Create women_only ride as driver if female'
        ]
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await checkUserEligibility(eligibilityData);

      expect(result.eligible).toBe(false);
      expect(result.failedChecks[0].required).toBe('female');
    });

    it('debería verificar elegibilidad basada en edad', async () => {
      const eligibilityData = {
        userId: mockUserId,
        action: 'create_ride',
        age_requirements: { minimum: 18, maximum: 75 }
      };

      const mockResult = {
        eligible: true,
        age_check: {
          current_age: 34,
          meets_minimum: true,
          meets_maximum: true,
          age_verified: true
        }
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await checkUserEligibility(eligibilityData);

      expect(result.eligible).toBe(true);
      expect(result.age_check.current_age).toBe(34);
    });
  });

  describe('✅ Aplicación de Políticas de Negocio (applyBusinessPolicies)', () => {
    it('debería aplicar políticas de precios dinámicos', async () => {
      const policyData = {
        context: 'ride_pricing',
        data: {
          base_price: 25.50,
          route: 'Madrid-Barcelona',
          time: 'friday_evening',
          demand_level: 'high'
        }
      };

      const mockResult = {
        applied: true,
        policies: [
          { name: 'weekend_surcharge', factor: 1.2, amount: 5.10 },
          { name: 'evening_premium', factor: 1.1, amount: 2.55 },
          { name: 'high_demand', factor: 1.15, amount: 3.83 }
        ],
        final_price: 36.98,
        breakdown: {
          base: 25.50,
          adjustments: 11.48,
          total: 36.98
        }
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await applyBusinessPolicies(policyData);

      expect(result.applied).toBe(true);
      expect(result.policies).toHaveLength(3);
      expect(result.final_price).toBe(36.98);
    });

    it('debería aplicar políticas de cancelación', async () => {
      const policyData = {
        context: 'cancellation',
        data: {
          user_role: 'driver',
          cancellation_time: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(), // 2 horas antes
          ride_price: 25.50
        }
      };

      const mockResult = {
        applied: true,
        penalties: [
          { type: 'driver_cancellation', amount: 5.10, percentage: 20 },
          { type: 'last_minute', amount: 2.55, percentage: 10 }
        ],
        total_penalty: 7.65,
        passenger_compensation: 2.55
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await applyBusinessPolicies(policyData);

      expect(result.applied).toBe(true);
      expect(result.total_penalty).toBe(7.65);
      expect(result.passenger_compensation).toBe(2.55);
    });

    it('debería aplicar políticas de reembolso', async () => {
      const policyData = {
        context: 'refund',
        data: {
          reason: 'service_quality',
          time_since_ride: 24 * 60 * 60, // 24 horas
          original_price: 25.50,
          user_history: 'good'
        }
      };

      const mockResult = {
        applied: true,
        refund_policy: {
          eligible: true,
          refund_percentage: 75,
          refund_amount: 19.12,
          conditions_met: ['within_timeframe', 'valid_reason', 'good_history']
        },
        processing_time: 'instant'
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await applyBusinessPolicies(policyData);

      expect(result.applied).toBe(true);
      expect(result.refund_policy.refund_amount).toBe(19.12);
    });
  });

  describe('✅ Validación de Cumplimiento (validateCompliance)', () => {
    it('debería validar cumplimiento regulatorio', async () => {
      const complianceData = {
        jurisdiction: 'Spain',
        ride_type: 'regular',
        driver_status: 'professional'
      };

      const mockResult = {
        compliant: true,
        checks: [
          { area: 'insurance', status: 'valid', expiry: '2024-12-31' },
          { area: 'driver_license', status: 'valid', class: 'B' },
          { area: 'vehicle_inspection', status: 'valid', last_inspection: '2024-01-15' }
        ],
        regulations: {
          transportation_law: 'compliant',
          data_protection: 'compliant',
          consumer_rights: 'compliant'
        }
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await validateCompliance(complianceData);

      expect(result.compliant).toBe(true);
      expect(result.checks).toHaveLength(3);
      expect(result.regulations.transportation_law).toBe('compliant');
    });

    it('debería detectar problemas de cumplimiento', async () => {
      const complianceData = {
        jurisdiction: 'Spain',
        ride_type: 'international'
      };

      const mockResult = {
        compliant: false,
        violations: [
          { area: 'international_permit', status: 'missing', required: true },
          { area: 'border_crossing_authorization', status: 'expired', expiry: '2023-12-31' }
        ],
        actions_required: [
          'Obtain international transportation permit',
          'Renew border crossing authorization'
        ]
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await validateCompliance(complianceData);

      expect(result.compliant).toBe(false);
      expect(result.violations).toHaveLength(2);
    });
  });

  describe('✅ Verificación de Rate Limits (checkRateLimits)', () => {
    it('debería verificar rate limits correctamente', async () => {
      const rateLimitData = {
        userId: mockUserId,
        action: 'create_ride',
        window_minutes: 60
      };

      const mockResult = {
        within_limit: true,
        current_count: 2,
        max_allowed: 10,
        remaining_requests: 8,
        window_reset: new Date(Date.now() + 30 * 60 * 1000).toISOString()
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await checkRateLimits(rateLimitData);

      expect(result.within_limit).toBe(true);
      expect(result.current_count).toBe(2);
      expect(result.remaining_requests).toBe(8);
    });

    it('debería detectar exceso de rate limit', async () => {
      const rateLimitData = {
        userId: mockUserId,
        action: 'create_ride',
        window_minutes: 60
      };

      const mockResult = {
        within_limit: false,
        current_count: 10,
        max_allowed: 10,
        retry_after: 1800, // 30 minutos
        penalty_applied: false
      };
      
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await checkRateLimits(rateLimitData);

      expect(result.within_limit).toBe(false);
      expect(result.retry_after).toBe(1800);
    });
  });

  describe('🔧 Manejo de Errores en Validaciones', () => {
    it('debería manejar error de conexión en validación', async () => {
      supabase.rpc.mockRejectedValue(new Error('Connection timeout'));

      const businessData = {
        userId: mockUserId,
        action: 'create_ride',
        data: mockRideData
      };

      await expect(validateBusinessRules(businessData)).rejects.toThrow('Connection timeout');
    });

    it('debería manejar datos inválidos en validación', async () => {
      supabase.rpc.mockResolvedValue({ 
        data: null, 
        error: { message: 'Datos de validación inválidos' } 
      });

      const pricingData = {
        price: -25.50, // Negativo
        distance: 615
      };

      await expect(validatePricing(pricingData)).rejects.toThrow();
    });

    it('debería registrar errores para debugging', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      supabase.rpc.mockResolvedValue({ 
        data: null, 
        error: { message: 'Error de prueba en validación' } 
      });

      const businessData = {
        userId: mockUserId,
        action: 'create_ride',
        data: mockRideData
      };

      await expect(validateBusinessRules(businessData)).rejects.toThrow();
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Validation Service]'),
        expect.any(Error)
      );
      
      consoleSpy.mockRestore();
    });
  });

  describe('📊 Tests de Rendimiento de Validaciones', () => {
    it('debería completar validación simple en tiempo razonable', async () => {
      const startTime = Date.now();
      
      supabase.rpc.mockResolvedValue({ 
        data: { valid: true }, 
        error: null 
      });

      await validatePricing({ price: 25.50, distance: 615 });
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      expect(duration).toBeLessThan(1000); // Menos de 1 segundo
    });

    it('debería manejar múltiples validaciones simultáneas', async () => {
      const promises = [];
      const startTime = Date.now();
      
      // 20 validaciones simultáneas
      for (let i = 0; i < 20; i++) {
        supabase.rpc.mockResolvedValue({ 
          data: { valid: true }, 
          error: null 
        });
        
        promises.push(validatePricing({ price: 25.50 + i, distance: 615 }));
      }

      await Promise.all(promises);
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      expect(duration).toBeLessThan(3000); // Menos de 3 segundos para 20 validaciones
    });
  });
});

export default {};
