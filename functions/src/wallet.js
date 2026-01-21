const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

const REGION = "us-central1";
const db = admin.firestore();

/**
 * Permite a un usuario liberar fondos que se han quedado atascados en 'heldBalance'.
 * Esta es una función de utilidad y seguridad.
 */
exports.releaseHeldFunds = onCall({ region: REGION, cors: true }, async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Debes estar autenticado.");
    }

    const userId = request.auth.uid;
    const walletRef = db.collection('wallets').doc(userId);

    try {
        return db.runTransaction(async (transaction) => {
            const walletDoc = await transaction.get(walletRef);

            if (!walletDoc.exists) {
                throw new HttpsError("not-found", "No se encontró tu wallet.");
            }

            const heldBalance = walletDoc.data().heldBalance || 0;

            if (heldBalance <= 0) {
                return { success: true, message: "No hay saldo retenido para liberar." };
            }

            // Mueve el saldo de 'heldBalance' al 'balance' principal y pone 'heldBalance' a 0.
            transaction.update(walletRef, {
                balance: admin.firestore.FieldValue.increment(heldBalance),
                heldBalance: 0
            });

            console.log(`Liberados ${heldBalance} del saldo retenido para el usuario ${userId}.`);
            return { success: true, message: `Se han liberado ${heldBalance.toFixed(2)}€ a tu saldo principal.` };
        });
    } catch (error) {
        console.error(`Error en releaseHeldFunds para el usuario ${userId}:`, error);
        if (error instanceof HttpsError) throw error;
        throw new HttpsError("internal", "No se pudieron liberar los fondos. Inténtalo de nuevo.");
    }
});
