/**
 * Helper functions para tests de utils
 * Proporciona datos de prueba y utilidades comunes para utilidades
 */

// Datos de prueba para pricing rules
export const pricingTestData = {
  validDistance: 100,
  shortDistance: 10,
  longDistance: 500,
  zeroDistance: 0,
  negativeDistance: -10,
  validPrice: 25.50,
  highPrice: 100.00,
  lowPrice: 5.00,
  negativePrice: -10.00,
  zeroPrice: 0.00
};

// Funciones de prueba para pricing
export const calculateSuggestedPrice = (distance) => {
  if (distance <= 0) return 0.00;
  const baseRate = 0.05; // 0.05€ por km
  const minimumPrice = 5.00;
  const price = distance * baseRate;
  return Math.max(price, minimumPrice);
};

export const validateRidePrice = (price, distance) => {
  if (price < 0) return { valid: false, error: 'Price cannot be negative' };
  if (distance <= 0) return { valid: false, error: 'Distance must be positive' };
  
  const maxRate = 0.60; // 0.60€ por km máximo
  const maxPrice = distance * maxRate;
  
  if (price > maxPrice) {
    return { 
      valid: false, 
      error: `Price exceeds maximum rate of €${maxRate}/km. Maximum allowed: €${maxPrice.toFixed(2)}` 
    };
  }
  
  return { valid: true };
};

// Mock functions para testing
export const mockPricingService = {
  calculateSuggestedPrice: vi.fn(calculateSuggestedPrice),
  validateRidePrice: vi.fn(validateRidePrice),
  getMarketRates: vi.fn(() => ({
    average: 0.08,
    minimum: 0.05,
    maximum: 0.60
  }))
};

// Test data generator
export const generatePricingTestCases = () => {
  return [
    { distance: 100, expectedPrice: 5.00, description: 'Standard distance' },
    { distance: 10, expectedPrice: 5.00, description: 'Short distance (minimum price)' },
    { distance: 500, expectedPrice: 25.00, description: 'Long distance' },
    { distance: 0, expectedPrice: 0.00, description: 'Zero distance' },
    { distance: -10, expectedPrice: 0.00, description: 'Negative distance' }
  ];
};

// Validation test cases
export const generateValidationTestCases = () => {
  return [
    { price: 25.50, distance: 100, expected: true, description: 'Valid price' },
    { price: 60.00, distance: 100, expected: false, description: 'Price exceeds max rate' },
    { price: -10.00, distance: 100, expected: false, description: 'Negative price' },
    { price: 25.50, distance: 0, expected: false, description: 'Zero distance' },
    { price: 25.50, distance: -10, expected: false, description: 'Negative distance' }
  ];
};

export default {
  pricingTestData,
  calculateSuggestedPrice,
  validateRidePrice,
  mockPricingService,
  generatePricingTestCases,
  generateValidationTestCases
};
