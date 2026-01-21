const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

const REGION = "us-central1";
const db = admin.firestore();

/**
 * Obtiene un chat existente entre dos usuarios o crea uno nuevo si no existe.
 * Es la forma segura y centralizada de iniciar una conversación.
 */
exports.getOrCreateChat = onCall({ region: REGION, cors: true }, async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Debes estar autenticado.");
    }

    const { otherUserId } = request.data;
    const currentUserId = request.auth.uid;

    if (!otherUserId || otherUserId === currentUserId) {
        throw new HttpsError("invalid-argument", "Se requiere un ID de usuario válido.");
    }

    const participants = [currentUserId, otherUserId].sort();
    const chatId = participants.join('_');

    const chatRef = db.collection('chats').doc(chatId);
    const chatDoc = await chatRef.get();

    if (chatDoc.exists) {
        return { chatId: chatDoc.id };
    }

    try {
        const currentUserDoc = await db.collection('users').doc(currentUserId).get();
        const otherUserDoc = await db.collection('users').doc(otherUserId).get();

        if (!currentUserDoc.exists || !otherUserDoc.exists) {
            throw new HttpsError("not-found", "No se encontró uno de los perfiles de usuario.");
        }

        const currentUserData = currentUserDoc.data();
        const otherUserData = otherUserDoc.data();

        // --- INICIO DE LA CORRECCIÓN ---
        const newChatData = {
            participants,
            participantDetails: {
                [currentUserId]: {
                    displayName: currentUserData.displayName || 'Usuario',
                    photoURL: currentUserData.photoURL || null
                },
                [otherUserId]: {
                    displayName: otherUserData.displayName || 'Usuario',
                    photoURL: otherUserData.photoURL || null
                }
            },
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            lastActivity: admin.firestore.FieldValue.serverTimestamp(),
            lastMessagePreview: "Chat iniciado.",
            unreadCount: {
                [currentUserId]: 0,
                [otherUserId]: 0
            }
        };
        // --- FIN DE LA CORRECCIÓN ---

        await chatRef.set(newChatData);

        console.log(`Chat creado con ID: ${chatId} entre ${currentUserId} y ${otherUserId}`);
        return { chatId };

    } catch (error) {
        console.error("Error al crear el chat:", error);
        if (error instanceof HttpsError) throw error;
        throw new HttpsError("internal", "No se pudo crear el chat.");
    }
});
