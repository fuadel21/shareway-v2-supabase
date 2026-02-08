/**
 * Servicio de Solicitudes - Migrado a Supabase
 */
import { createRideRequest } from '@/services/rideService';

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
 * Llama a la función RPC 'create_ride_request' para que un pasajero publique una nueva solicitud.
 * @param {object} requestData - Los datos de la solicitud (origen, destino, etc.).
 * @returns {Promise<string>} El ID de la solicitud creada.
 */
export const createSingleRequest = async (requestData) => {
    if (!requestData.origin?.coordinates || !requestData.destination?.coordinates) {
        throw new AppError('validation/no-coords', "Las coordenadas de origen y destino no son válidas.");
    }

    try {
        const result = await createRideRequest({
            origin: requestData.origin,
            destination: requestData.destination,
            dateTime: requestData.dateTime,
            seats: requestData.seats,
            price: requestData.suggestedPrice || 0,
            note: requestData.details || '',
            isWomenOnly: requestData.isWomenOnly || false,
            distance: requestData.distance || 0,
            overview_polyline: requestData.overview_polyline || ''
        });

        if (result?.success) return result.requestId;
        throw new AppError('function/execution-failed', result?.message || 'La función no pudo completar la operación.');

    } catch (error) {
        console.error("Error al llamar a la función create_ride_request:", error);
        throw new AppError(error.code || 'unknown', error.message || "Error al crear la solicitud");
    }
};
