
import { RIDE_PRICING_CONFIG as ConfigFromUtils } from '../src/utils/pricingRules.js';
// Simulamos el entorno para importar rideService que usa alias @
// Nota: Esto puede ser complicado con Node puro si no usamos un loader.
// Vamos a intentar leer el archivo y hacer un chequeo estático simple o usar vitest para ejecutarlo.

console.log("Verificando integridad de configuración de precios...");

if (!ConfigFromUtils || !ConfigFromUtils.TIERS) {
    console.error("❌ FALLO: No se pudo importar RIDE_PRICING_CONFIG de pricingRules.js");
    process.exit(1);
}

console.log("✅ RIDE_PRICING_CONFIG exportado correctamente de pricingRules.js");
console.log("Tramos configurados:", ConfigFromUtils.TIERS.length);
console.log("Primer tramo:", ConfigFromUtils.TIERS[0]);

if (ConfigFromUtils.TIERS[0].rate !== 1.00) {
    console.error("❌ FALLO: El primer tramo debería ser 1.00€/km");
    process.exit(1);
}

console.log("Integridad verificada.");
