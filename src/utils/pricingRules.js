/**
 * Reglas de precios para viajes compartidos.
 * Extraído de componentes UI para facilitar testing puro.
 */

export const PRICING_CONSTANTS = {
    MAX_RATE_PER_KM: 0.60,
    SUGGESTED_RATE_PER_KM: 0.18,
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

    const maxPrice = distanceKm * PRICING_CONSTANTS.MAX_RATE_PER_KM;

    // Usamos un pequeño margen de error para comparaciones flotantes si fuera necesario,
    // pero para moneda simple > funciona.
    if (price > maxPrice) {
        return {
            valid: false,
            error: 'Precio excesivo detectado',
            maxPrice: parseFloat(maxPrice.toFixed(2)),
            details: `El máximo para esta distancia (${distanceKm.toFixed(1)}km) es de ${maxPrice.toFixed(2)}€. Por favor, ajusta tu oferta.`
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
    return (distanceKm * PRICING_CONSTANTS.SUGGESTED_RATE_PER_KM).toFixed(2);
};
