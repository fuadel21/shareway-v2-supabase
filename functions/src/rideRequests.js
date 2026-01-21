const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const { FieldValue, GeoPoint } = require("firebase-admin/firestore");

const REGION = "us-central1";
const db = admin.firestore();

/**
 * Permite a un usuario crear una nueva solicitud de viaje de forma segura.
 */
exports.createRideRequest = onCall({ region: REGION, cors: true }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Debes estar autenticado para solicitar un viaje.");
  }

  const { origin, destination, dateTime, seats, suggestedPrice, details } = request.data;

  // Validación robusta de datos de entrada
  if (
    !origin?.address || !origin?.coordinates ||
    !destination?.address || !destination?.coordinates ||
    !dateTime || !seats || suggestedPrice == null
  ) {
    throw new HttpsError("invalid-argument", "Faltan datos esenciales (origen, destino, fecha, asientos o precio).");
  }
  if (typeof seats !== 'number' || seats <= 0) {
      throw new HttpsError("invalid-argument", "El número de asientos no es válido.");
  }
  if (typeof suggestedPrice !== 'number' || suggestedPrice < 0) {
      throw new HttpsError("invalid-argument", "La contribución sugerida no es válida.");
  }

  const requesterId = request.auth.uid;

  try {
    const userDoc = await db.collection('users').doc(requesterId).get();
    if (!userDoc.exists) {
        throw new HttpsError("not-found", "No se encontró tu perfil de usuario para crear la solicitud.");
    }
    const userData = userDoc.data();

    const newRequestData = {
      requester: {
        id: requesterId,
        displayName: userData.displayName || 'Usuario',
        photoURL: userData.photoURL || null,
      },
      origin: { address: origin.address },
      destination: { address: destination.address },
      originCoords: new GeoPoint(origin.coordinates.lat, origin.coordinates.lng),
      destinationCoords: new GeoPoint(destination.coordinates.lat, destination.coordinates.lng),
      dateTime: new Date(dateTime),
      seats: Number(seats),
      suggestedPrice: Number(suggestedPrice),
      details: details || '',
      status: 'pending',
      createdAt: FieldValue.serverTimestamp(),
    };

    const newRequestRef = await db.collection('rideRequests').add(newRequestData);

    return { success: true, requestId: newRequestRef.id };

  } catch (error) {
    console.error(`Error al crear la solicitud de viaje para el usuario ${requesterId}:`, error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", "Ocurrió un error inesperado al guardar la solicitud.");
  }
});

/**
 * Permite al creador de una solicitud de viaje cancelarla.
 */
exports.cancelRideRequest = onCall({ region: REGION, cors: true }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Debes estar autenticado.");
  }

  const { requestId } = request.data;
  if (!requestId) {
    throw new HttpsError("invalid-argument", "Falta el ID de la solicitud.");
  }

  const currentUserId = request.auth.uid;
  const requestRef = db.collection('rideRequests').doc(requestId);

  try {
    const requestDoc = await requestRef.get();
    if (!requestDoc.exists) {
      throw new HttpsError("not-found", "La solicitud ya no existe.");
    }

    if (requestDoc.data().requester?.id !== currentUserId) {
      throw new HttpsError("permission-denied", "No tienes permiso para cancelar esta solicitud.");
    }

    await requestRef.delete();

    return { success: true, message: "Solicitud cancelada con éxito." };

  } catch (error) {
    console.error("Error al cancelar la solicitud:", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", "No se pudo cancelar la solicitud.");
  }
});

/**
 * Permite a un conductor aceptar una solicitud de viaje y crear un nuevo viaje.
 */
exports.acceptRequest = onCall({ region: REGION, cors: true }, async (request) => { /* ... */ });
