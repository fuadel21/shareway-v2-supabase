const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");

const db = admin.firestore();
const REGION = "us-central1";

/**
 * Se dispara cuando se actualiza un documento de usuario.
 * Sincroniza el rol de la base de datos con los Custom Claims de Firebase Auth.
 */
exports.syncUserRole = onDocumentUpdated({ document: "users/{userId}", region: REGION }, async (event) => {
    console.log(`Sync User Role: Detectado cambio en el documento del usuario: ${event.params.userId}`);

    const beforeData = event.data.before.data();
    const afterData = event.data.after.data();

    if (!beforeData || !afterData) {
        console.log("Sync User Role: Faltan datos (before o after), probablemente es una creación de documento. Abortando.");
        return null;
    }

    if (beforeData.role === afterData.role) {
        console.log(`Sync User Role: El rol no ha cambiado (${afterData.role}). No se requieren acciones.`);
        return null;
    }

    console.log(`Sync User Role: ¡Cambio de rol detectado! Antes: ${beforeData.role}, Ahora: ${afterData.role}`);

    const userId = event.params.userId;
    const newRole = afterData.role;

    try {
        await admin.auth().setCustomUserClaims(userId, { role: newRole });
        console.log(`Sync User Role: Custom Claim 'role: ${newRole}' establecido con éxito para el usuario ${userId}.`);
        return null;
    } catch (error) {
        console.error(`Sync User Role: Error al establecer Custom Claims para el usuario ${userId}:`, error);
        return null;
    }
});

exports.updateUserProfile = onCall({ region: REGION, cors: true }, async (request) => {
    // ... (código existente sin cambios)
});
