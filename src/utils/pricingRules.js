/**
 * Canonical client-side pricing and settlement constants.
 *
 * The database migration
 * `20260901120000_reconcile_ride_financial_rules.sql` is the authoritative
 * enforcement layer. Keep these values aligned with that migration so the UI
 * can preview exactly what the server will accept.
 */

export const PRICING_CONSTANTS = Object.freeze({
    MIN_PRICE: 0.50,
    MAX_PRICE: 300,
    MIN_SEATS: 1,
    MAX_SEATS: 8,
});

export const FINANCIAL_RULES = Object.freeze({
    PLATFORM_COMMISSION_RATE: 0.10,
    DRIVER_PAYOUT_RATE: 0.90,
    DETOUR_THRESHOLD_KM: 3,
    PICKUP_SUPPLEMENT: 1.50,
    PASSENGER_REFUND_FULL_AFTER_HOURS: 24,
    PASSENGER_REFUND_HALF_AFTER_HOURS: 2,
    DRIVER_CANCELLATION_PENALTY_UNDER_TWO_HOURS: 5.00,
    DRIVER_CANCELLATION_PENALTY_UNDER_24_HOURS: 2.00,
});

// Progressive tiers used by both ride publication and request publication.
// From 50 km onward, the marginal rate is fixed at 0.15 EUR/km with no
// further distance tier.
export const RIDE_PRICING_CONFIG = Object.freeze({
    TIERS: Object.freeze([
        { maxKm: 15, rate: 0.30 },
        { maxKm: 50, rate: 0.216 },
        { maxKm: Infinity, rate: 0.15 },
    ]),
});

export const roundMoney = (value) => Number(Number(value || 0).toFixed(2));

/**
 * Calculate the progressive suggested price for a distance in kilometres.
 * Invalid/non-positive distances return 0.00 so forms can show that a route
 * still needs to be calculated. A valid short trip is never below 0.50 EUR.
 */
export const calculateSuggestedPrice = (distanceKm) => {
    if (!Number.isFinite(Number(distanceKm)) || Number(distanceKm) <= 0) return '0.00';

    let remainingDistance = Number(distanceKm);
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

    return roundMoney(Math.max(
        PRICING_CONSTANTS.MIN_PRICE,
        Math.min(PRICING_CONSTANTS.MAX_PRICE, totalPrice),
    )).toFixed(2);
};

/**
 * Validate a driver's/requester's per-seat offer.
 * Offers may be lower than the suggestion, never higher than it (apart from
 * the 0.05 EUR rounding tolerance).
 */
export const validateRidePrice = (price, distanceKm) => {
    if (!Number.isFinite(Number(distanceKm)) || Number(distanceKm) <= 0) {
        return { valid: false, error: 'Distancia inválida' };
    }

    if (typeof price !== 'number' || !Number.isFinite(price) || price < 0) {
        return { valid: false, error: 'Precio inválido' };
    }

    if (price < PRICING_CONSTANTS.MIN_PRICE) {
        return {
            valid: false,
            error: 'Precio inferior al mínimo',
            minPrice: PRICING_CONSTANTS.MIN_PRICE,
        };
    }

    if (price > PRICING_CONSTANTS.MAX_PRICE) {
        return {
            valid: false,
            error: 'Precio superior al máximo',
            maxPrice: PRICING_CONSTANTS.MAX_PRICE,
        };
    }

    const suggestedPrice = Number(calculateSuggestedPrice(distanceKm));
    if (price > suggestedPrice + 0.05) {
        return {
            valid: false,
            error: 'Precio superior al sugerido',
            maxPrice: suggestedPrice,
            details: `Para garantizar precios justos, no puedes superar el precio recomendado de ${suggestedPrice}€ para este trayecto.`,
        };
    }

    return { valid: true };
};

/**
 * Quote a passenger booking using the same geometry-independent arithmetic as
 * the server RPC. Distances are supplied by the caller after being calculated
 * from coordinates; the server recomputes them before accepting payment.
 */
export const calculateBookingTotal = ({
    ridePrice,
    rideDistanceKm,
    passengerDistanceKm,
    detourDistanceKm,
    numSeats = 1,
}) => {
    const seats = Math.trunc(Number(numSeats));
    const safeRidePrice = Number(ridePrice);
    const safeRideDistance = Math.max(Number(rideDistanceKm) || 0, 1);
    const safePassengerDistance = Math.max(Number(passengerDistanceKm) || 0, 0.5);
    const safeDetourDistance = Math.max(Number(detourDistanceKm) || 0, 0);
    const supplement = safeDetourDistance > FINANCIAL_RULES.DETOUR_THRESHOLD_KM
        ? FINANCIAL_RULES.PICKUP_SUPPLEMENT
        : 0;
    const total = roundMoney(Math.max(
        PRICING_CONSTANTS.MIN_PRICE * Math.max(seats, 1),
        ((safeRidePrice / safeRideDistance) * safePassengerDistance + supplement) * Math.max(seats, 1),
    ));

    return {
        total,
        pricePerSeat: roundMoney(total / Math.max(seats, 1)),
        supplement,
        passengerDistanceKm: safePassengerDistance,
        detourDistanceKm: safeDetourDistance,
        numSeats: Math.max(seats, 1),
    };
};
