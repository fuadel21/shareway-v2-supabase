/**
 * Servicio de Reservas - Migrado a Supabase
 */
import {
  cancelBookingAndRefund as cancelBookingAndRefundRPC,
  confirmTripAndPay as confirmTripAndPayRPC,
  confirmPassengerArrival as confirmPassengerArrivalRPC
} from '@/lib/supabaseRPC.js';
import { supabase } from '@/lib/supabase';
import { createNotification } from '@/services/notificationService';

/**
 * Error personalizado
 */
class AppError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = 'AppError';
  }
}

/**
 * Calcula el monto de reembolso estimado según la política de cancelación PARANOIC.
 * Política:
 * - Periodo de gracia: < 15 min desde reserva (si falta > 3h para salida): 100%
 * - > 24h antes: 100% reembolso
 * - >= 2h antes: 50% reembolso
 * - < 2h antes o ya iniciado: 0% reembolso
 * 
 * @param {object} ride - Objeto del viaje (debe tener departure_time y price)
 * @param {object} passengerInfo - Info del pasajero (con booked_at)
 * @returns {object} - { amount: number, percentage: number, message: string }
 */
export const calculateRefundAmount = (ride, passengerInfo = null) => {
  if (!ride || !ride.departure_time) return { amount: 0, percentage: 0, message: "Datos insuficientes" };

  const departureDate = new Date(ride.departure_time);
  const now = new Date();
  const hoursUntilDeparture = (departureDate - now) / (1000 * 60 * 60);
  const price = parseFloat(ride.price) || 0;

  // Lógica para solicitudes pendientes (Refund 100% siempre)
  if (passengerInfo?.status === 'pending') {
    return {
      amount: price,
      percentage: 100,
      message: "Reembolso completo (Solicitud pendiente)"
    };
  }

  // Periodo de gracia (15 min)
  if (passengerInfo?.booked_at) {
    const bookedAt = new Date(passengerInfo.booked_at);
    const minutesSinceBooking = (now - bookedAt) / (1000 * 60);
    if (minutesSinceBooking <= 15 && hoursUntilDeparture > 3) {
      return {
        amount: price,
        percentage: 100,
        message: "Reembolso completo (Periodo de gracia 15 min)"
      };
    }
  }

  if (hoursUntilDeparture > 24) {
    return {
      amount: price,
      percentage: 100,
      message: "Reembolso completo (más de 24h antes)"
    };
  } else if (hoursUntilDeparture >= 2) {
    return {
      amount: price * 0.5,
      percentage: 50,
      message: "Reembolso del 50% (entre 24h y 2h antes)"
    };
  } else {
    return {
      amount: 0,
      percentage: 0,
      message: "Sin reembolso (menos de 2h antes o ya iniciado)"
    };
  }
};

/**
 * Cancela una reserva y libera los fondos.
 * @param {string} rideId - El ID del viaje.
 * @returns {Promise<object>} - El resultado.
 */
export const cancelBooking = async (rideId) => {
  if (!rideId) {
    throw new AppError('validation/missing-ride-id', "Falta el ID del viaje para cancelar.");
  }

  try {
    const result = await cancelBookingAndRefundRPC(rideId);

    if (result.success) {
      return result;
    } else {
      throw new AppError('function/failed', result.message || 'Error al cancelar la reserva');
    }
  } catch (error) {
    console.error("Error al cancelar reserva:", error);
    throw new AppError(error.code || 'unknown', error.message || "Error al intentar cancelar tu reserva");
  }
};

/**
 * Confirma una reserva y realiza el pago (retención).
 * @param {string} rideId - El ID del viaje.
 * @param {string|null} requestId - El ID de la solicitud original (opcional).
 * @returns {Promise<object>} - El resultado.
 */
export const confirmTripAndPay = async (rideId, requestId = null) => {
  if (!rideId) {
    throw new AppError('validation/missing-ride-id', "Falta el ID del viaje para reservar.");
  }

  try {
    const result = await confirmTripAndPayRPC(rideId, requestId);

    if (result.success) {
      return result;
    } else {
      throw new AppError('function/failed', result.message || 'Error al confirmar la reserva');
    }
  } catch (error) {
    console.error("Error al reservar:", error);
    throw error; // RE-THROW ERROR
  }
};

/**
 * Confirma que el pasajero ha llegado a su destino.
 * @param {string} rideId - El ID del viaje.
 * @returns {Promise<object>} - El resultado.
 */
export const confirmArrival = async (rideId) => {
  if (!rideId) throw new AppError('validation/missing-ride-id', "Falta el ID del viaje.");
  try {
    const result = await confirmPassengerArrivalRPC(rideId);
    return result;
  } catch (error) {
    console.error("Error al confirmar llegada:", error);
    throw new AppError(error.code || 'unknown', error.message || "Error al confirmar llegada");
  }
};
