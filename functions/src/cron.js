const functions = require('firebase-functions');
const admin = require("firebase-admin");

const db = admin.firestore();
const REGION = "us-central1";

/**
 * Se ejecuta cada hora para limpiar y actualizar estados de la base de datos.
 */
exports.hourlyCleanup = functions.region(REGION).pubsub
    .schedule('every 60 minutes')
    .onRun(async (context) => {
        console.log('Iniciando la tarea de limpieza horaria...');

        const now = admin.firestore.Timestamp.now();

        // 1. Marcar viajes caducados
        const expiredRidesQuery = db.collection('rides')
            .where('status', '==', 'scheduled')
            .where('dateTime', '<', now);

        try {
            const snapshot = await expiredRidesQuery.get();
            if (snapshot.empty) {
                console.log("No se encontraron viajes caducados para actualizar.");
                return null;
            }

            const batch = db.batch();
            snapshot.docs.forEach(doc => {
                console.log(`Marcando viaje ${doc.id} como caducado.`);
                batch.update(doc.ref, { status: 'expired' });
            });

            await batch.commit();
            console.log(`Se actualizaron ${snapshot.size} viajes caducados.`);
            return null;

        } catch (error) {
            console.error("Error al actualizar los viajes caducados:", error);
            return null;
        }
    });
