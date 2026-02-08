
import { calculateRecommendedPrice } from './src/services/rideService.js';

console.log("--- Verificación de Tarifas ---");
console.log("3km:", calculateRecommendedPrice(3000));
console.log("10km:", calculateRecommendedPrice(10000));
console.log("50km:", calculateRecommendedPrice(50000));
console.log("100km:", calculateRecommendedPrice(100000));
console.log("200km:", calculateRecommendedPrice(200000));
console.log("400km:", calculateRecommendedPrice(400000));
console.log("500km:", calculateRecommendedPrice(500000));
