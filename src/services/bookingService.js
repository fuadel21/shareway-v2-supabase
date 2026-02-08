/**
 * Servicio de Reservas - Blindaje Antifraude v3.1
 * Optimización: Atomicidad garantizada vía safeCall RPC.
 */
import { supabase } from '@/lib/supabase';
import * as rpc from '@/lib/supabaseRPC';

/**
 * Calcula el monto de reembolso basado en reglas de tiempo.
 */
export const calculateRefundAmount = (ride, passengerInfo = null) => {
  if (!ride || !ride.departure_time) return { amount: 0, percentage: 0 };
  
  const departureDate = new Date(ride.departure_time);
  const now = new Date();
  const hoursUntilDeparture = (departureDate - now) / (1000 * 60 * 60);
  const price = parseFloat(ride.price) || 0;

  // Si el viaje ya pasó y no se inició, reembolso total (Seguridad de Plataforma)
  if (hoursUntilDeparture < 0 && ride.status === 'scheduled') {
    return { amount: price, percentage: 100, message: "Reembolso total (Viaje Caducado)" };
  }

  if (hoursUntilDeparture > 24) return { amount: price, percentage: 100 };
  if (hoursUntilDeparture >= 2) return { amount: price * 0.5, percentage: 50 };
  
  return { amount: 0, percentage: 0 };
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
export const confirmTripAndPay = async (rideId, requestId = null) => {
  if (!rideId) throw new Error("ID de viaje requerido.");

  try {
    const { data, success, error } = await rpc.confirmTripAndPay(rideId, requestId);

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
