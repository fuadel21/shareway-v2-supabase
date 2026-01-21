const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const db = admin.firestore();
const REGION = "us-central1";

exports.getPlatformStats = onCall({ region: REGION, cors: true }, async (request) => {
    // ... (código existente sin cambios)
});

// --- INICIO DE LA CORRECCIÓN ---

exports.requestPlatformPayout = onCall({ region: REGION, cors: true }, async (request) => {
    if (request.auth?.token.role !== 'admin') {
        throw new HttpsError("permission-denied", "Esta función solo puede ser llamada por un administrador.");
    }

    const platformFeesRef = db.collection('platform').doc('fees');

    try {
        return db.runTransaction(async (transaction) => {
            const feesDoc = await transaction.get(platformFeesRef);
            if (!feesDoc.exists) {
                throw new HttpsError("not-found", "No se encontraron registros de comisiones.");
            }

            const totalUncollectedFees = feesDoc.data().totalUncollected || 0;
            if (totalUncollectedFees <= 0) {
                throw new HttpsError("failed-precondition", "No hay comisiones para retirar.");
            }

            // Stripe maneja las cantidades en céntimos
            const amountInCents = Math.round(totalUncollectedFees * 100);

            // Crear la transferencia al banco conectado en Stripe
            const transfer = await stripe.transfers.create({
                amount: amountInCents,
                currency: "eur",
                // Por defecto, se transfiere a la cuenta bancaria principal configurada en Stripe.
                description: `Retiro de comisiones de la plataforma - ${new Date().toLocaleDateString()}`,
            });

            // Si la transferencia tiene éxito, resetear el contador
            transaction.update(platformFeesRef, { totalUncollected: 0 });

            console.log(`Transferencia ${transfer.id} creada por ${totalUncollectedFees.toFixed(2)}€`);

            return { success: true, message: `Se ha iniciado una transferencia de ${totalUncollectedFees.toFixed(2)}€ a tu cuenta.` };
        });

    } catch (error) {
        console.error("Error al solicitar el retiro de comisiones:", error);
        if (error instanceof HttpsError) throw error;
        throw new HttpsError("internal", "Ocurrió un error inesperado al procesar el retiro.");
    }
});

// --- FIN DE LA CORRECCIÓN ---
