const admin = require("firebase-admin");
const { onCall, HttpsError } = require("firebase-functions/v2/https");

const stripeKey = process.env.STRIPE_SECRET_KEY;
let stripe;
if (stripeKey) {
    stripe = require('stripe')(stripeKey);
} else {
    console.error("¡ERROR CRÍTICO! La variable de entorno STRIPE_SECRET_KEY no está configurada.");
}

const db = admin.firestore();
const REGION = "us-central1";
const PLATFORM_FEE_PERCENTAGE = 0.10; // 10% de comisión

exports.addFunds = onCall({ region: REGION, cors: true }, async (request) => {
    // ... (código existente sin cambios)
});

exports.requestPayout = onCall({ region: REGION, cors: true }, async (request) => {
    // ... (código existente sin cambios)
});

// --- INICIO DE LA CORRECCIÓN ---

const transferFundsToDriver = async (rideData, rideId) => {
    const driverId = rideData.driver?.id;
    if (!driverId) throw new Error(`El viaje ${rideId} no tiene un conductor asignado.`);

    const confirmedPassengers = rideData.passengers?.filter(p => p.status === 'confirmed') || [];
    if (confirmedPassengers.length === 0) {
        // No hay fondos que transferir.
        return db.collection('rides').doc(rideId).update({ paymentProcessed: true });
    }

    const pricePerPassenger = rideData.price;
    if (typeof pricePerPassenger !== 'number' || pricePerPassenger <= 0) {
        throw new Error(`El precio por pasajero para el viaje ${rideId} no es válido.`);
    }

    const platformFeePerPassenger = pricePerPassenger * PLATFORM_FEE_PERCENTAGE;
    const amountForDriverPerPassenger = pricePerPassenger - platformFeePerPassenger;

    const driverWalletRef = db.collection('wallets').doc(driverId);
    const platformFeesRef = db.collection('platform').doc('fees'); // Referencia a la "caja" del admin

    return db.runTransaction(async (transaction) => {
        let totalAmountForDriver = 0;
        let totalPlatformFee = 0;

        for (const passenger of confirmedPassengers) {
            const passengerWalletRef = db.collection('wallets').doc(passenger.id);
            const passengerWalletDoc = await transaction.get(passengerWalletRef);
            if (!passengerWalletDoc.exists) throw new Error(`La wallet del pasajero ${passenger.id} no fue encontrada.`);

            const passengerHeldBalance = passengerWalletDoc.data().heldBalance || 0;
            if (passengerHeldBalance < pricePerPassenger) throw new Error(`El pasajero ${passenger.id} no tiene suficientes fondos retenidos.`);

            // 1. Mover el dinero del pasajero
            transaction.update(passengerWalletRef, { heldBalance: admin.firestore.FieldValue.increment(-pricePerPassenger) });
            
            // 2. Crear transacción de gasto para el pasajero
            const passengerTxRef = passengerWalletRef.collection('transactions').doc();
            transaction.set(passengerTxRef, {
                amount: -pricePerPassenger, type: 'payment', date: admin.firestore.FieldValue.serverTimestamp(),
                description: `Pago por viaje a ${rideData.destination.address}`, status: 'completed'
            });

            totalAmountForDriver += amountForDriverPerPassenger;
            totalPlatformFee += platformFeePerPassenger;
        }

        // 3. Añadir el dinero al balance del conductor
        transaction.update(driverWalletRef, { balance: admin.firestore.FieldValue.increment(totalAmountForDriver) });

        // 4. Crear transacción de ingreso para el conductor
        const driverTxRef = driverWalletRef.collection('transactions').doc();
        transaction.set(driverTxRef, {
            amount: totalAmountForDriver, type: 'payout', date: admin.firestore.FieldValue.serverTimestamp(),
            description: `Ingreso por viaje a ${rideData.destination.address}`, status: 'completed'
        });

        // 5. Acumular la comisión en la "caja" de la plataforma
        transaction.set(platformFeesRef, { totalUncollected: admin.firestore.FieldValue.increment(totalPlatformFee) }, { merge: true });

        // 6. Crear un registro de la comisión para contabilidad
        const feeTxRef = platformFeesRef.collection('transactions').doc();
        transaction.set(feeTxRef, {
            amount: totalPlatformFee, rideId: rideId, date: admin.firestore.FieldValue.serverTimestamp(),
            description: `Comisión del 10% del viaje a ${rideData.destination.address}`
        });

        // 7. Marcar el viaje como procesado
        transaction.update(db.collection('rides').doc(rideId), { paymentProcessed: true });
    });
};

const refundFundsToPassengers = async (rideData, rideId) => {
    const passengersToRefund = rideData.passengers?.filter(p => p.status === 'confirmed') || [];
    if (passengersToRefund.length === 0) {
        // Viaje cancelado sin pasajeros que reemboolsar
        return db.collection('rides').doc(rideId).update({ paymentProcessed: true });
    }

    const pricePerPassenger = rideData.price;
    if (typeof pricePerPassenger !== 'number' || pricePerPassenger <= 0) {
        throw new Error(`El precio por pasajero para el viaje ${rideId} no es válido.`);
    }

    return db.runTransaction(async (transaction) => {
        let needsManualIntervention = false;
        const errorMessages = [];

        for (const passenger of passengersToRefund) {
            const passengerWalletRef = db.collection('wallets').doc(passenger.id);
            const passengerWalletDoc = await transaction.get(passengerWalletRef);

            if (!passengerWalletDoc.exists) {
                console.error(`La wallet del pasajero ${passenger.id} no fue encontrada para el reembolso del viaje ${rideId}.`);
                needsManualIntervention = true;
                errorMessages.push(`Wallet for passenger ${passenger.id} not found.`);
                continue;
            }

            const passengerHeldBalance = passengerWalletDoc.data().heldBalance || 0;
            if (passengerHeldBalance < pricePerPassenger) {
                console.warn(`El pasajero ${passenger.id} no tiene suficientes fondos retenidos para reembolsar en el viaje ${rideId}.`);
                needsManualIntervention = true;
                errorMessages.push(`Held balance for ${passenger.id} is less than ride price.`);
                continue;
            }

            // 1. Devolver fondos del balance retenido al balance principal
            transaction.update(passengerWalletRef, {
                heldBalance: admin.firestore.FieldValue.increment(-pricePerPassenger),
                balance: admin.firestore.FieldValue.increment(pricePerPassenger)
            });

            // 2. Crear transacción de reembolso
            const passengerTxRef = passengerWalletRef.collection('transactions').doc();
            transaction.set(passengerTxRef, {
                amount: pricePerPassenger,
                type: 'refund',
                date: admin.firestore.FieldValue.serverTimestamp(),
                description: `Reembolso por viaje cancelado a ${rideData.destination.address}`,
                status: 'completed'
            });
        }

        // 3. Marcar el viaje como procesado y registrar si necesita intervención
        transaction.update(db.collection('rides').doc(rideId), {
            paymentProcessed: true,
            needsManualRefund: needsManualIntervention,
            paymentError: errorMessages.length > 0 ? errorMessages.join('; ') : null
        });
    });
};

exports.handleRideCompletion = async (event) => {
    const beforeData = event.data.before.data();
    const afterData = event.data.after.data();
    const rideId = event.data.after.id;

    if (afterData.paymentProcessed) return null;

    const statusChanged = beforeData.status !== afterData.status;
    if (!statusChanged) return null;

    try {
        if (afterData.status === 'completed') await transferFundsToDriver(afterData, rideId);
        if (afterData.status === 'cancelled') await refundFundsToPassengers(afterData, rideId);
        return null;
    } catch (error) {
        console.error(`Error procesando el pago para ${rideId}:`, error);
        return db.collection('rides').doc(rideId).update({ paymentError: error.message });
    }
};

// --- FIN DE LA CORRECCIÓN ---
