/**
 * Servicio de Reservas - Blindaje Antifraude v3.1
 * Optimización: Atomicidad garantizada vía safeCall RPC.
 */
import * as rpc from '@/lib/supabaseRPC';

/**
 * Estimates the refund for presentation only.
 *
 * The cancellation RPC recalculates the amount from the locked booking and is
 * the only authority allowed to move money. In particular, ride.price is a
 * per-seat driver price and must not be used as the total when passengerInfo
 * contains the persisted booking amount.
 */
export const calculateRefundAmount = (ride, passengerInfo = null) => {
  if (!ride?.departure_time) return { amount: 0, percentage: 0, serverAuthoritative: false, presentationOnly: true };

  const departureDate = new Date(ride.departure_time);
  if (Number.isNaN(departureDate.getTime())) {
    return { amount: 0, percentage: 0, serverAuthoritative: false, presentationOnly: true };
  }

  const hoursUntilDeparture = (departureDate.getTime() - Date.now()) / (1000 * 60 * 60);
  const requestedSeats = Number(passengerInfo?.seats_booked ?? passengerInfo?.num_seats ?? 1);
  const seats = Number.isFinite(requestedSeats) && requestedSeats >= 1
    ? Math.min(8, Math.floor(requestedSeats))
    : 1;
  const persistedTotal = Number(passengerInfo?.payment_amount);
  const bookedPrice = Number(passengerInfo?.booked_price);
  const derivedTotal = Number.isFinite(bookedPrice) && bookedPrice >= 0
    ? Math.round(bookedPrice * seats * 100) / 100
    : null;
  const persistedAmountMismatch = derivedTotal !== null
    && Number.isFinite(persistedTotal)
    && persistedTotal !== derivedTotal;
  // Show the persisted amount actually attached to the booking whenever it is
  // available. The mutation endpoint still validates it against booked_price ×
  // seats atomically; this estimate can never authorize a refund.
  const total = Number.isFinite(persistedTotal) && persistedTotal >= 0
    ? Math.round(persistedTotal * 100) / 100
    : derivedTotal !== null
      ? derivedTotal
      : Math.max(0, Number(ride.price) || 0) * seats;

  const percentage = hoursUntilDeparture > 24 ? 100 : hoursUntilDeparture >= 2 ? 50 : 0;
  const amount = Math.round(total * percentage) / 100;

  return {
    amount,
    percentage,
    total,
    persistedAmountMismatch,
    serverAuthoritative: false,
    presentationOnly: true,
  };
};

/**
 * Confirma que el pasajero ha llegado (Libera fondos al conductor)
 */
export const confirmArrival = async (rideId) => {
  try {
    const { data, success, error } = await rpc.confirmPassengerArrival(rideId);
    if (!success) throw new Error(error);
    return { success: true, data };
  } catch (error) {
    console.error("🛡️ [Booking] Error confirmando llegada:", error.message);
    throw error;
  }
};

/**
 * Motor de Reserva Principal (Atomic Enforcement)
 * El flujo de "Pedir Plaza" en un viaje existente.
 */
export const confirmTripAndPay = async (rideId, requestId = null, additionalData = {}) => {
  if (!rideId) throw new Error("ID de viaje requerido.");

  try {
    const { data, success, error } = await rpc.confirmTripAndPay(
      rideId,
      requestId,
      additionalData
    );

    if (!success) {
      // Mapeo exhaustivo de errores de negocio desde el RPC de PostgreSQL
      const errorMap = {
        'SIN_PLAZAS_LIBRES': "Lo sentimos, ya no quedan plazas libres.",
        'SALDO_INSUFICIENTE': "Saldo insuficiente. Por favor, recarga tu wallet.",
        'VIAJE_YA_INICIADO': "El viaje ya ha comenzado y no acepta más reservas.",
        'PROPIO_VIAJE': "No puedes reservar en tu propio viaje.",
        'USER_SUSPENDED': "Tu cuenta está suspendida temporalmente.",
        'ALREADY_BOOKED': "Ya tienes una reserva activa en este viaje."
      };

      const message = Object.keys(errorMap).find(key => error?.includes(key))
        ? errorMap[Object.keys(errorMap).find(key => error?.includes(key))]
        : (error || "No se pudo completar la reserva.");

      throw new Error(message);
    }

    return { success: true, data };

  } catch (error) {
    console.error("🛡️ [Booking Engine] Failure:", error.message);
    throw error;
  }
};

/**
 * Cancela una reserva y procesa el reembolso automático según reglas de negocio.
 */
export const cancelBooking = async (rideId) => {
  try {
    const { data, success, error } = await rpc.cancelBookingAndRefund(rideId);
    if (!success) throw new Error(error);
    return { success: true, data };
  } catch (error) {
    console.error("🛡️ [Booking] Cancelation failed:", error.message);
    throw error;
  }
};
