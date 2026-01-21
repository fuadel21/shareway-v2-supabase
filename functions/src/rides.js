const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

const REGION = "us-central1";
const db = admin.firestore();

exports.createRide = onCall({ region: REGION, cors: true }, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Debes estar autenticado para crear un viaje.");

    const driverId = request.auth.uid;
    const data = request.data;
    const { origin, destination, dateTime, seats, price, details, distance, overview_polyline, bounds, isWomenOnly } = data;

    if (!origin || !destination || !dateTime || !seats || price == null || !distance || !overview_polyline || !bounds) {
        throw new HttpsError("invalid-argument", "Faltan datos esenciales para crear el viaje.");
    }

    try {
        const driverDoc = await db.collection('users').doc(driverId).get();
        if (!driverDoc.exists) throw new HttpsError("not-found", "No se encontró el perfil del conductor.");

        const driverData = driverDoc.data();
        const newRide = {
            driver: { id: driverId, displayName: driverData.displayName || 'Conductor', photoURL: driverData.photoURL || null },
            origin,
            destination,
            dateTime: new Date(dateTime),
            seatsTotal: seats,
            seatsAvailable: seats,
            price,
            details: details || '',
            distance,
            overview_polyline,
            bounds,
            isWomenOnly: !!isWomenOnly,
            passengers: [],
            participantIds: [driverId],
            status: 'scheduled',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        };

        const rideRef = await db.collection('rides').add(newRide);
        return { success: true, rideId: rideRef.id };

    } catch (error) {
        console.error("Error en createRide:", error);
        if (error instanceof HttpsError) throw error;
        throw new HttpsError("internal", "Ha ocurrido un error inesperado al crear el viaje.");
    }
});

exports.confirmTripAndPay = onCall({ region: REGION, cors: true }, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Debes estar autenticado.");

    const { rideId } = request.data;
    const passengerId = request.auth.uid;
    const rideRef = db.collection('rides').doc(rideId);
    const walletRef = db.collection('wallets').doc(passengerId);

    try {
        return db.runTransaction(async (transaction) => {
            const rideDoc = await transaction.get(rideRef);
            if (!rideDoc.exists) throw new HttpsError("not-found", "El viaje ya no existe.");

            const walletDoc = await transaction.get(walletRef);
            if (!walletDoc.exists) throw new HttpsError("not-found", "No se encontró tu wallet.");

            const rideData = rideDoc.data();
            const walletData = walletDoc.data();

            if (rideData.seatsAvailable <= 0) throw new HttpsError("failed-precondition", "No quedan asientos.");
            if (walletData.balance < rideData.price) throw new HttpsError("failed-precondition", "No tienes saldo suficiente.");
            if (rideData.passengers.some(p => p.id === passengerId)) throw new HttpsError("already-exists", "Ya tienes una reserva.");
            if (rideData.driver.id === passengerId) throw new HttpsError("permission-denied", "No puedes reservar tu propio viaje.");

            const ridePin = Math.floor(1000 + Math.random() * 9000).toString();
            const newPassenger = { id: passengerId, displayName: request.auth.token.name || 'Pasajero', photoURL: request.auth.token.picture || null, status: 'confirmed', pin: ridePin };

            transaction.update(walletRef, { balance: admin.firestore.FieldValue.increment(-rideData.price), heldBalance: admin.firestore.FieldValue.increment(rideData.price) });
            transaction.update(rideRef, { passengers: admin.firestore.FieldValue.arrayUnion(newPassenger), participantIds: admin.firestore.FieldValue.arrayUnion(passengerId), seatsAvailable: admin.firestore.FieldValue.increment(-1) });

            return { success: true };
        });
    } catch (error) {
        console.error(`Error en confirmTripAndPay para ${passengerId}:`, error);
        if (error instanceof HttpsError) throw error;
        throw new HttpsError("internal", "No se pudo procesar la reserva.");
    }
});

exports.startRide = onCall({ region: REGION, cors: true }, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Debes estar autenticado.");

    const { rideId, pin } = request.data;
    const userId = request.auth.uid;
    const rideRef = db.collection('rides').doc(rideId);

    try {
        const rideDoc = await rideRef.get();
        if (!rideDoc.exists) throw new HttpsError("not-found", "El viaje no existe.");

        const rideData = rideDoc.data();
        if (rideData.driver.id !== userId) throw new HttpsError("permission-denied", "Solo el conductor puede iniciar el viaje.");
        if (rideData.status !== 'scheduled') throw new HttpsError("failed-precondition", "El viaje no se puede iniciar.");

        const firstPassenger = rideData.passengers?.find(p => p.status === 'confirmed');
        if (!firstPassenger && rideData.passengers?.length > 0) { // Allow starting if there are passengers, even if none confirmed (edge case)
             console.log("Iniciando viaje sin pasajeros confirmados (posiblemente un caso de prueba).");
        } else if (!firstPassenger) {
             throw new HttpsError("failed-precondition", "Se necesita al menos un pasajero para iniciar.");
        }

        if (firstPassenger && firstPassenger.pin !== pin) {
            throw new HttpsError("permission-denied", "El PIN del pasajero no es correcto.");
        }

        await rideRef.update({ status: 'in_progress' });
        return { success: true, message: "¡Viaje iniciado con éxito!" };

    } catch (error) {
        if (error instanceof HttpsError) throw error;
        console.error(`Error al iniciar el viaje ${rideId}:`, error);
        throw new HttpsError("internal", "Ocurrió un error inesperado al iniciar.");
    }
});

exports.completeRide = onCall({ region: REGION, cors: true }, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Debes estar autenticado.");
    const { rideId } = request.data;
    const rideRef = db.collection('rides').doc(rideId);
    try {
        const rideDoc = await rideRef.get();
        if (!rideDoc.exists) throw new HttpsError("not-found", "El viaje no existe.");
        if (rideDoc.data().driver.id !== request.auth.uid) throw new HttpsError("permission-denied", "Solo el conductor puede completar el viaje.");

        await rideRef.update({ status: 'completed' });
        return { success: true, message: "Viaje completado." };
    } catch (error) {
        console.error(`Error al completar el viaje ${rideId}:`, error);
        throw new HttpsError("internal", "No se pudo completar el viaje.");
    }
});

exports.cancelRide = onCall({ region: REGION, cors: true }, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Debes estar autenticado.");
    const { rideId } = request.data;
    const rideRef = db.collection('rides').doc(rideId);
    try {
        const rideDoc = await rideRef.get();
        if (!rideDoc.exists) throw new HttpsError("not-found", "El viaje no existe.");
        if (rideDoc.data().driver.id !== request.auth.uid) throw new HttpsError("permission-denied", "Solo el conductor puede cancelar el viaje.");

        await rideRef.update({ status: 'cancelled' });
        return { success: true, message: "Viaje cancelado." };
    } catch (error) {
        console.error(`Error al cancelar el viaje ${rideId}:`, error);
        throw new HttpsError("internal", "No se pudo cancelar el viaje.");
    }
});