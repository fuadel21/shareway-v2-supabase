const admin = require("firebase-admin");
const db = admin.firestore();

/**
 * Envía una notificación a un usuario específico.
 * @param {string} uid - El ID del usuario al que se le enviará la notificación.
 * @param {object} payload - El contenido de la notificación (title, body).
 */
const sendNotification = async (uid, payload) => {
    try {
        const userRef = db.collection('users').doc(uid);
        const userDoc = await userRef.get();

        if (!userDoc.exists || !userDoc.data().fcmToken) {
            console.log(`Usuario ${uid} no encontrado o sin token FCM.`);
            return;
        }

        const token = userDoc.data().fcmToken;
        const message = {
            notification: {
                title: payload.title,
                body: payload.body,
            },
            token: token,
        };

        await admin.messaging().send(message);
        console.log(`Notificación enviada con éxito a ${uid}`);

    } catch (error) {
        console.error(`Error al enviar notificación a ${uid}:`, error);
    }
};

module.exports = {
    /**
     * Se dispara cuando se actualiza un viaje. Detecta nuevas solicitudes,
     * aceptaciones y rechazos para enviar notificaciones.
     */
    handleRideUpdateNotifications: async (change) => {
        const beforeData = change.before.data();
        const afterData = change.after.data();

        // 1. Detectar nueva solicitud -> Notificar al CONDUCTOR
        const beforePending = beforeData.pendingPassengerUids || [];
        const afterPending = afterData.pendingPassengerUids || [];

        const newRequesters = afterPending.filter(uid => !beforePending.includes(uid));
        if (newRequesters.length > 0) {
            const requesterId = newRequesters[0]; // Asumimos una solicitud a la vez
            const requesterProfile = await db.collection('users').doc(requesterId).get();
            const requesterName = requesterProfile.data()?.displayName || 'Alguien';

            await sendNotification(afterData.driverId, {
                title: 'Nueva solicitud de viaje',
                body: `${requesterName} quiere unirse a tu viaje de ${afterData.origin.address}.`
            });
        }

        // 2. Detectar solicitud gestionada -> Notificar al PASAJERO
        const managedRequesters = beforePending.filter(uid => !afterPending.includes(uid));
        if (managedRequesters.length > 0) {
            const managedId = managedRequesters[0];

            const wasAccepted = afterData.passengerUids.includes(managedId);
            if (wasAccepted) {
                // Solicitud ACEPTADA
                await sendNotification(managedId, {
                    title: '¡Plaza confirmada!',
                    body: `El conductor ha aceptado tu solicitud para el viaje a ${afterData.destination.address}.`
                });
            } else {
                // Solicitud RECHAZADA
                await sendNotification(managedId, {
                    title: 'Solicitud rechazada',
                    body: `Tu solicitud para el viaje a ${afterData.destination.address} no ha sido aceptada.`
                });
            }
        }
    }
};