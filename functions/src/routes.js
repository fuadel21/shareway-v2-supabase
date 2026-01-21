const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { Client } = require("@googlemaps/google-maps-services-js");

const REGION = "us-central1";

// --- CORRECCIÓN DE SEGURIDAD Y SINTAXIS ---
// El cliente de Google Maps se inicializa sin clave aquí. La clave se pasa en cada llamada.
const mapsClient = new Client({});

exports.getRideDetails_v1 = onCall({ region: REGION }, async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Debes estar autenticado.");
    }

    const { origin, destination } = request.data;
    if (!origin || !destination) {
        throw new HttpsError("invalid-argument", "Se requieren origen y destino.");
    }

    // Se lee la clave desde las variables de entorno, no directamente en el código.
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
        console.error("La clave de API de Google Maps no está configurada en las variables de entorno.");
        throw new HttpsError("internal", "Error de configuración del servidor.");
    }

    try {
        const response = await mapsClient.directions({
            params: {
                origin: origin,
                destination: destination,
                mode: 'driving',
                key: apiKey
            },
        });

        if (response.data.routes.length === 0) {
            throw new HttpsError("not-found", "No se encontró una ruta válida.");
        }

        const route = response.data.routes[0].legs[0];
        const distanceMeters = route.distance.value;
        const durationSeconds = route.duration.value;
        const distanceKm = distanceMeters / 1000;

        const suggestedPrice = Math.max(2.00, 1.00 + distanceKm * 0.25).toFixed(2);

        return {
            distance: route.distance.text,
            duration: route.duration.text,
            distanceMeters,
            durationSeconds,
            suggestedPrice: parseFloat(suggestedPrice),
        };

    } catch (error) {
        console.error("Error en la Directions API:", error.response?.data?.error_message || error.message);
        throw new HttpsError("internal", error.response?.data?.error_message || "No se pudo calcular la ruta en el servidor.");
    }
});
