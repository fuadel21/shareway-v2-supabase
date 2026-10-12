// Calculo de precio de reserva EN EL CLIENTE.
// Misma formula que sw_build_booking_quote (FIX_BOOKING_QUOTE_V2.sql):
//   km geodesicos x 1.20 (circuidad carretera) -> tarifa progresiva
//   0-15km 0.30 EUR/km · 15-100km 0.22 · +100km 0.15 (min 0.50, max 300)
//   + 1.50 EUR/plaza si la recogida esta a mas de 3 km del origen
//   tope: nunca supera el precio publicado si el trayecto cabe en el del ride
// El servidor SIEMPRE recalcula y cobra su propio importe al confirmar.

const getLat = (loc) => Number(loc?.lat ?? loc?.latitude ?? loc?.coordinates?.lat ?? loc?.coordinates?.latitude);
const getLng = (loc) => Number(loc?.lng ?? loc?.longitude ?? loc?.coordinates?.lng ?? loc?.coordinates?.longitude);

export const isValidLocation = (loc) => {
    const lat = getLat(loc);
    const lng = getLng(loc);
    return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
};

export const normalizeLocation = (loc) => {
    if (!loc) return null;
    const lat = getLat(loc);
    const lng = getLng(loc);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { ...loc, lat, lng };
};

export const roundMoney = (value) => Number(Number(value || 0).toFixed(2));

export const localHaversineKm = (a, b) => {
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(Math.max(s, 0))));
};

export const localProgressivePrice = (km) => Math.min(Math.max(
    Math.min(km, 15) * 0.30 + Math.max(Math.min(km, 100) - 15, 0) * 0.22 + Math.max(km - 100, 0) * 0.15,
    0.50), 300);

export const buildLocalQuote = (ride, pickup, dropoff, numSeats) => {
    const seats = Math.max(parseInt(numSeats, 10) || 1, 1);
    const p = normalizeLocation(pickup);
    const d = normalizeLocation(dropoff);
    if (!ride || !p || !d) return null;

    const rideOrigin = normalizeLocation(ride.origin);
    const rideDestination = normalizeLocation(ride.destination);
    if (!rideOrigin || !rideDestination) return null;

    const billedKm = Math.max(localHaversineKm(p, d) * 1.20, 0.6);
    const rideDistance = Number(ride.distance) > 0
        ? Number(ride.distance)
        : Math.max(localHaversineKm(rideOrigin, rideDestination), 1);

    const tariff = localProgressivePrice(billedKm);
    const ridePrice = Number(ride.price);
    const basePerSeat = billedKm <= rideDistance * 1.10
        ? Math.min(tariff, Number.isFinite(ridePrice) && ridePrice > 0 ? ridePrice : tariff)
        : tariff;

    const supplement = localHaversineKm(rideOrigin, p) > 3 ? 1.50 : 0;
    const pricePerSeat = roundMoney(Math.max(basePerSeat + supplement, 0.50));
    const total = roundMoney(pricePerSeat * seats);

    return {
        total,
        pricePerSeat,
        seats,
        billedKm: Math.round(billedKm * 10) / 10,
        supplement,
        platformFee: roundMoney(total * 0.10),
        driverPayout: roundMoney(total - roundMoney(total * 0.10)),
    };
};
