/**
 * Climate Impact Utility
 * Provides standardized calculations and messaging for CO2 impact to avoid greenwashing.
 * 
 * Baselines based on EEA (European Environment Agency) 2024 data:
 * - Average Passenger Car (EU): ~110-120 g CO2/km (conservative baseline for comparison)
 * - Mature Tree Absorption: ~22 kg CO2/year (~60g/day)
 */

// Constants
const AVG_CAR_EMISSION_G_PER_KM = 120; 
const TREE_ABSORPTION_KG_PER_YEAR = 22;

/**
 * Calculates the CO2 saved for a shared ride.
 * @param {number} distanceKm - Distance of the ride in km.
 * @param {number} passengers - Number of passengers (excluding driver).
 * @returns {object} { savedKg, explanation }
 */
export const calculateImpact = (distanceKm, passengers = 1) => {
    if (!distanceKm || distanceKm <= 0) return { savedKg: 0, explanation: '' };

    // Calculation Logic:
    // If these passengers drove their own cars: Emissions = passengers * distance * AVG_CAR
    // Shared ride emissions (marginal increase ignored for simplicity or amortized): 
    // We count the "removed cars" from the road.
    // Saved = passengers * (distance * AVG_CAR_EMISSION_G_PER_KM) / 1000 (to get kg)
    
    const savedKg = (passengers * distanceKm * AVG_CAR_EMISSION_G_PER_KM) / 1000;
    
    return {
        savedKg: parseFloat(savedKg.toFixed(2)),
        raw: savedKg
    };
};

/**
 * Generates a relatable comparison for the CO2 amount.
 * @param {number} kgCO2 - Amount of CO2 in kg.
 * @returns {string} Relatable string (e.g., "Equivalent to 1 tree's work for 2 months")
 */
export const getImpactEquivalency = (kgCO2) => {
    if (kgCO2 <= 0) return null;

    // Trees
    const treeYears = kgCO2 / TREE_ABSORPTION_KG_PER_YEAR;
    const treeDays = treeYears * 365;

    if (treeDays < 1) {
        return "Equivale a cargar 50 smartphones"; // Approx 0.05kg CO2
    } else if (treeDays < 30) {
        return `Equivale a ${Math.round(treeDays)} días de absorción de un árbol`;
    } else {
        const months = Math.round(treeDays / 30);
        return `Equivale a lo que absorbe un árbol en ${months} mes${months > 1 ? 'es' : ''}`;
    }
};

/**
 * Formats the savings for display.
 * @param {number} kgCO2 
 * @returns {object} { value, unit, colorClass }
 */
export const formatImpactDisplay = (kgCO2) => {
    return {
        value: kgCO2.toFixed(1),
        unit: 'kg CO₂',
        label: 'Ahorro Estimado',
        color: 'text-emerald-600 bg-emerald-50 border-emerald-100'
    };
};
