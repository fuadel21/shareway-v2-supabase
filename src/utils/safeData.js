/**
 * Safe Data Extraction Utility
 * Prevents UI crashes by providing safe fallbacks for nested database objects.
 */

export const safeRide = (ride) => {
    if (!ride) return null;
    return {
        ...ride,
        origin: {
            name: ride.origin?.name || 'Origen desconocido',
            address: ride.origin?.address || 'Dirección no disponible',
            lat: parseFloat(ride.origin?.lat || ride.origin?.coordinates?.lat || ride.origin?.latitude || 0),
            lng: parseFloat(ride.origin?.lng || ride.origin?.coordinates?.lng || ride.origin?.longitude || 0),
        },
        destination: {
            name: ride.destination?.name || 'Destino desconocido',
            address: ride.destination?.address || 'Dirección no disponible',
            lat: parseFloat(ride.destination?.lat || ride.destination?.coordinates?.lat || ride.destination?.latitude || 0),
            lng: parseFloat(ride.destination?.lng || ride.destination?.coordinates?.lng || ride.destination?.longitude || 0),
        },
        driver: {
            id: ride.driver?.id || ride.driver_id,
            display_name: ride.driver?.display_name || ride.driver?.full_name || 'Miembro ShareWay',
            photo_url: ride.driver?.photo_url || ride.driver?.avatar_url || '',
            rating: parseFloat(ride.driver?.rating || 0).toFixed(1),
            verification: {
                status: ride.driver?.verification?.status || 'not_verified'
            },
            vehicle: ride.driver?.vehicle || { make: 'Vehículo', model: 'estándar', color: '' }
        },
        seats_available: parseInt(ride.seats_available || 0),
        price: parseFloat(ride.price || 0),
        distance: parseFloat(ride.distance || 0),
        departure_time: ride.departure_time || new Date().toISOString()
    };
};

export const safeRequest = (request) => {
    if (!request) return null;
    return {
        ...request,
        origin: {
            name: request.origin?.name || 'Punto de recogida',
            address: request.origin?.address || '',
            lat: parseFloat(request.origin?.lat || request.origin?.coordinates?.lat || 0),
            lng: parseFloat(request.origin?.lng || request.origin?.coordinates?.lng || 0),
        },
        destination: {
            name: request.destination?.name || 'Destino',
            address: request.destination?.address || '',
            lat: parseFloat(request.destination?.lat || request.destination?.coordinates?.lat || 0),
            lng: parseFloat(request.destination?.lng || request.destination?.coordinates?.lng || 0),
        },
        requester: {
            id: request.requester?.id || request.requester_id,
            display_name: request.requester?.display_name || request.requester?.full_name || 'Usuario',
            photo_url: request.requester?.photo_url || request.requester?.avatar_url || '',
            verification: {
                status: request.requester?.verification?.status || 'not_verified'
            }
        },
        suggested_price: parseFloat(request.suggested_price || 0),
        seats_needed: parseInt(request.seats_needed || 1)
    };
};
