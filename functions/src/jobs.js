const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");

const REGION = "us-central1";
const db = admin.firestore();

const archiveRideForUser = (batch, userId, rideId, rideData) => {
    if (!userId) return false;
    const historyRef = db.collection('users').doc(userId).collection('rideHistory').doc(rideId);
    batch.set(historyRef, rideData);
    return true;
};

exports.archivePastRides_v2 = onSchedule({ region: REGION, schedule: "every 60 minutes", timeoutSeconds: 540, memory: "512MiB" }, async (event) => {
    const now = admin.firestore.Timestamp.now();
    const ridesRef = db.collection("rides");

    // Buscamos viajes programados cuya fecha ya ha pasado
    const query = ridesRef
        .where("status", "==", "scheduled")
        .where("dateTime", "<=", now);

    try {
        const snapshot = await query.get();
        if (snapshot.empty) {
            console.log("No hay viajes caducados para archivar.");
            return null;
        }

        const promises = [];
        snapshot.forEach(doc => {
            const rideId = doc.id;
            const rideData = doc.data();

            const promise = db.runTransaction(async (transaction) => {
                let wasArchived = false;
                const rideDataWithStatus = { ...rideData, status: 'completed' };

                // 1. Archivar para el conductor
                if (rideData.driver?.id) {
                    const historyRef = db.collection('users').doc(rideData.driver.id).collection('rideHistory').doc(rideId);
                    transaction.set(historyRef, rideDataWithStatus);
                    wasArchived = true;
                }

                // 2. Archivar para cada pasajero
                (rideData.passengers || []).forEach(passenger => {
                    if (passenger.uid) {
                        const historyRef = db.collection('users').doc(passenger.uid).collection('rideHistory').doc(rideId);
                        transaction.set(historyRef, rideDataWithStatus);
                        wasArchived = true;
                    }
                });

                // 3. Solo si se archivó para alguien, se borra el original
                if (wasArchived) {
                    transaction.delete(doc.ref);
                    console.log(`Viaje ${rideId} archivado y eliminado.`);
                } else {
                    console.log(`Viaje ${rideId} no tenía participantes, se marcará como cancelado.`);
                    transaction.update(doc.ref, { status: 'cancelled' });
                }
            });
            promises.push(promise);
        });

        await Promise.all(promises);
        console.log(`Proceso de archivado completado para ${snapshot.size} viajes.`);
        return null;

    } catch (error) {
        console.error("Error al archivar los viajes pasados:", error);
        return null;
    }
});
