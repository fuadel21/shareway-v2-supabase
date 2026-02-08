/**
 * Reglas de precios para viajes compartidos.
 * Extraído de componentes UI para facilitar testing puro.
 */

export const PRICING_CONSTANTS = {
    MAX_RATE_PER_KM: 0.60,
    // SUGGESTED_RATE_PER_KM no se usa más, se usa lógica progresiva en rideService.js
    // Mantenemos esta referencia para legacy si es necesario, pero actualizamos calculateSuggestedPrice
};

// IMPORTANTE: Mantener sincronizado con src/services/rideService.js
export const RIDE_PRICING_CONFIG = {
    TIERS: [
        { maxKm: 100, rate: 0.25 },
        { maxKm: 400, rate: 0.17 },
        { maxKm: Infinity, rate: 0.14 }
    ]
};

/**
 * Valida si el precio propuesto cumple con las regulaciones de coste compartido.
 * @param {number} price - Precio total por asiento propuesto
 * @param {number} distanceKm - Distancia del viaje en KM
 * @returns {Object} { valid: boolean, error?: string, maxPrice?: number, details?: string }
 */
export const validateRidePrice = (price, distanceKm) => {
    if (typeof distanceKm !== 'number' || distanceKm <= 0) {
        return { valid: false, error: 'Distancia inválida' };
    }

    if (typeof price !== 'number' || price < 0) {
        return { valid: false, error: 'Precio inválido' };
    }

    // NUEVA REGLA: No se permite subir el precio sugerido (solo bajarlo)
    const suggestedPrice = parseFloat(calculateSuggestedPrice(distanceKm));
    
    // Permitimos un pequeño margen por redondeo (e.g. 0.05)
    if (price > suggestedPrice + 0.05) {
        return {
            valid: false,
            error: 'Precio superior al sugerido',
            maxPrice: suggestedPrice,
            details: `Para garantizar precios justos, no puedes superar el precio recomendado de ${suggestedPrice}€ para este trayecto.`
        };
    }

    // Mantenemos la validación de seguridad (MAX_RATE_PER_KM) por si acaso, 
    // aunque la regla de suggestedPrice suele ser más restrictiva.
    const absoluteMaxPrice = distanceKm * PRICING_CONSTANTS.MAX_RATE_PER_KM;

    // Usamos un pequeño margen de error para comparaciones flotantes si fuera necesario,
    // pero para moneda simple > funciona.
    if (price > absoluteMaxPrice) {
        return {
            valid: false,
            error: 'Precio excesivo detectado',
            maxPrice: parseFloat(absoluteMaxPrice.toFixed(2)),
            details: `El máximo absoluto para esta distancia (${distanceKm.toFixed(1)}km) es de ${absoluteMaxPrice.toFixed(2)}€. Por favor, ajusta tu oferta.`
        };
    }

    return { valid: true };
};

/**
 * Calcula el precio sugerido basado en la distancia.
 * @param {number} distanceKm 
 * @returns {string} Precio formateado a 2 decimales string (para inputs) o number si lo prefieres.
 */
export const calculateSuggestedPrice = (distanceKm) => {
    if (!distanceKm || distanceKm < 0) return "0.00";
    
    let remainingDistance = distanceKm;
    let totalPrice = 0;
    let previousMaxKm = 0;

    for (const tier of RIDE_PRICING_CONFIG.TIERS) {
        if (remainingDistance <= 0) break;
        
        const tierRange = tier.maxKm - previousMaxKm;
        const kmInThisTier = Math.min(remainingDistance, tierRange);
        
        totalPrice += kmInThisTier * tier.rate;
        remainingDistance -= kmInThisTier;
        previousMaxKm = tier.maxKm;
    }

    return totalPrice.toFixed(2);
};
