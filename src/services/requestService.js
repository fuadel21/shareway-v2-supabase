/**
 * Servicio de Solicitudes - Migrado a Supabase
 */
import { createRideRequest as createRideRequestRPC } from '@/lib/supabaseRPC.js';
import { toast } from 'sonner';

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
        // Preparar datos para RPC
        const originData = {
            name: requestData.origin.name,
            address: requestData.origin.address,
            lat: requestData.origin.coordinates.lat,
            lng: requestData.origin.coordinates.lng
        };

        const destinationData = {
            name: requestData.destination.name,
            address: requestData.destination.address,
            lat: requestData.destination.coordinates.lat,
            lng: requestData.destination.coordinates.lng
        };

        const result = await createRideRequestRPC({
            origin: originData,
            destination: destinationData,
            departureTime: requestData.dateTime.toISOString(),
            seatsNeeded: requestData.seats,
            suggestedPrice: requestData.suggestedPrice || null,
            details: requestData.details || '',
            isWomenOnly: requestData.isWomenOnly || false
        });

        if (result?.success) {
            return result.requestId;
        } else {
            const errorMessage = result?.message || 'La función no pudo completar la operación.';
            throw new AppError('function/execution-failed', errorMessage);
        }

    } catch (error) {
        console.error("Error al llamar a la función create_ride_request:", error);
        throw new AppError(error.code || 'unknown', error.message || "Error al crear la solicitud");
    }
};
