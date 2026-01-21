const admin = require("firebase-admin");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const db = admin.firestore();
const REGION = "us-central1";

/**
 * Lógica interna y segura para reservar un asiento. Previene overbooking.
 */
const bookSeatInternal = async (transaction, rideId, userId, userName, userPhoto) => {
    const rideRef = db.collection('rides').doc(rideId);
    const walletRef = db.collection('wallets').doc(userId);

    const rideDoc = await transaction.get(rideRef);
    const walletDoc = await transaction.get(walletRef);

    if (!rideDoc.exists) throw new HttpsError("not-found", "El viaje ya no existe.");
    if (!walletDoc.exists) throw new HttpsError("not-found", "No se encontró tu wallet.");

    const rideData = rideDoc.data();
    const walletData = walletDoc.data();

    // ### INICIO DE LA CORRECCIÓN DE SEGURIDAD ###
    // 1. Verificar condiciones DENTRO de la transacción para prevenir race conditions
    if (rideData.driver.id === userId) {
        throw new HttpsError("failed-precondition", "No puedes reservar en tu propio viaje.");
    }
    if (rideData.seatsAvailable <= 0) {
        throw new HttpsError("failed-precondition", "Lo sentimos, el último asiento acaba de ser reservado.");
    }
    if (walletData.balance < rideData.price) {
        throw new HttpsError("failed-precondition", "No tienes saldo suficiente en tu wallet.");
    }
    const isAlreadyPassenger = rideData.passengers.some(p => p.id === userId);
    if (isAlreadyPassenger) {
        throw new HttpsError("already-exists", "Ya tienes una reserva en este viaje.");
    }
    // ### FIN DE LA CORRECCIÓN DE SEGURIDAD ###

    const newPassenger = {
        id: userId,
        name: userName || 'Pasajero',
        photoURL: userPhoto || null,
        status: 'confirmed'
    };

    // 2. Realizar las actualizaciones de forma atómica
    transaction.update(walletRef, {
        balance: admin.firestore.FieldValue.increment(-rideData.price),
        heldBalance: admin.firestore.FieldValue.increment(rideData.price)
    });

    transaction.update(rideRef, {
        passengers: admin.firestore.FieldValue.arrayUnion(newPassenger),
        participantIds: admin.firestore.FieldValue.arrayUnion(userId),
        seatsAvailable: admin.firestore.FieldValue.increment(-1)
    });

    return { success: true };
};


exports.requestSeatAndHoldFunds = onCall({ region: REGION, cors: true }, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Debes estar autenticado.");
    
    const { rideId } = request.data;
    const userId = request.auth.uid;
    const userName = request.auth.token.name;
    const userPhoto = request.auth.token.picture;

    try {
        await db.runTransaction(async (transaction) => {
            return bookSeatInternal(transaction, rideId, userId, userName, userPhoto);
        });
        return { success: true, message: `Reserva realizada con éxito.` };
    } catch (error) {
        console.error(`Error en requestSeatAndHoldFunds para ${userId} en viaje ${rideId}:`, error);
        if (error instanceof HttpsError) throw error;
        throw new HttpsError("internal", "No se pudo completar la reserva.");
    }
});


exports.cancelBookingAndRefund = onCall({ region: REGION, cors: true }, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Debes estar autenticado.");

    const { rideId } = request.data;
    const userId = request.auth.uid;
    const rideRef = db.collection('rides').doc(rideId);
    const walletRef = db.collection('wallets').doc(userId);

    try {
        await db.runTransaction(async (transaction) => {
            const rideDoc = await transaction.get(rideRef);
            if (!rideDoc.exists) throw new HttpsError("not-found", "El viaje ya no existe.");

            const rideData = rideDoc.data();
            const passengerIndex = rideData.passengers.findIndex(p => p.id === userId);
            if (passengerIndex === -1) throw new HttpsError("not-found", "No tienes una reserva en este viaje.");
            
            const walletDoc = await transaction.get(walletRef);
            if (!walletDoc.exists) throw new HttpsError("internal", `No se encontró la wallet del pasajero.`);

            const passengerHeldBalance = walletDoc.data().heldBalance || 0;
            if (passengerHeldBalance < rideData.price) {
                console.error(`Error de consistencia: El pasajero ${userId} cancela pero su saldo retenido (${passengerHeldBalance}) es menor que el precio del viaje (${rideData.price}).`);
            } else {
                 transaction.update(walletRef, {
                    balance: admin.firestore.FieldValue.increment(rideData.price),
                    heldBalance: admin.firestore.FieldValue.increment(-rideData.price)
                });
            }
            
            const updatedPassengers = rideData.passengers.filter(p => p.id !== userId);
            transaction.update(rideRef, {
                passengers: updatedPassengers,
                participantIds: admin.firestore.FieldValue.arrayRemove(userId),
                seatsAvailable: admin.firestore.FieldValue.increment(1)
            });
        });

        return { success: true, message: "Reserva cancelada y fondos devueltos a tu wallet." };

    } catch (error) {
        console.error(`Error al cancelar reserva para ${userId} en ${rideId}:`, error);
        if (error instanceof HttpsError) throw error;
        throw new HttpsError("internal", "No se pudo cancelar la reserva.");
    }
});


exports.confirmBookingAndTransferFunds = onCall({ region: REGION, cors: true }, async (request) => {
   // Esta función parece ser para otro flujo, se mantiene sin cambios
});
