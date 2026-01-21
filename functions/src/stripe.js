const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const REGION = "us-central1";
const db = admin.firestore();

// --- BUG FIX: ADDED MISSING CORE FUNCTIONALITY ---
/**
 * Crea una intención de pago (PaymentIntent) en Stripe.
 * Esto es el corazón del flujo para añadir fondos a la wallet.
 * @param {number} amount - La cantidad en la unidad principal (ej. euros) a añadir.
 * @returns {{clientSecret: string}} El secreto del cliente para ser usado en el frontend.
 */
exports.createPaymentIntent = onCall({ region: REGION, cors: true }, async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Debes estar autenticado para añadir fondos.");
    }
    const { amount } = request.data;
    const uid = request.auth.uid;

    // Validación robusta de la cantidad
    if (!amount || typeof amount !== 'number' || amount <= 0) {
        throw new HttpsError("invalid-argument", "La cantidad debe ser un número positivo.");
    }

    // Stripe trabaja con la unidad más pequeña (céntimos)
    const amountInCents = Math.round(amount * 100);

    // Una validación simple para prevenir cantidades astronómicas
    if (amountInCents > 99999999) { // Límite de ~1M EUR
         throw new HttpsError("invalid-argument", "La cantidad es demasiado grande.");
    }

    try {
        const paymentIntent = await stripe.paymentIntents.create({
            amount: amountInCents,
            currency: 'eur',
            automatic_payment_methods: { enabled: true },
            // Metadatos para auditoría y trazabilidad
            metadata: {
                firebase_uid: uid,
                user_email: request.auth.token.email || 'N/A'
            }
        });

        return {
            clientSecret: paymentIntent.client_secret,
        };
    } catch (error) {
        console.error(`[CRITICAL] Error al crear PaymentIntent para ${uid} por ${amount}€:`, error);
        throw new HttpsError("internal", error.message || "Ocurrió un error al crear la intención de pago.");
    }
});


exports.createStripeAccount = onCall({ region: REGION, cors: true }, async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Debes estar autenticado.");
    }
    const uid = request.auth.uid;
    const userRef = db.collection("users").doc(uid);

    try {
        const userDoc = await userRef.get();
        if (!userDoc.exists) {
            throw new HttpsError("not-found", "No se encontró tu perfil de usuario.");
        }
        const userData = userDoc.data();

        if (userData.stripeAccountId) {
            return { accountId: userData.stripeAccountId };
        }

        const account = await stripe.accounts.create({
            type: 'express',
            country: 'ES',
            email: userData.email,
            business_type: 'individual',
            individual: {
                first_name: userData.name?.split(' ')[0],
                last_name: userData.name?.split(' ').slice(1).join(' '),
                email: userData.email,
            },
        });

        await userRef.update({ stripeAccountId: account.id });
        return { accountId: account.id };
    } catch (error) {
        console.error(`Error al crear la cuenta de Stripe para el usuario ${uid}:`, error);
        throw new HttpsError("internal", error.message);
    }
});

exports.createStripeAccountLink = onCall({ region: REGION, cors: true }, async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Debes estar autenticado.");
    }

    const { accountId, origin } = request.data;
    if (!accountId || !origin) {
        throw new HttpsError("invalid-argument", "Faltan parámetros (accountId u origin).");
    }

    try {
        const accountLink = await stripe.accountLinks.create({
            account: accountId,
            refresh_url: `${origin}/settings/account?reauth=true`,
            return_url: `${origin}/settings/account?success=true`,
            type: 'account_onboarding',
        });
        return { url: accountLink.url };
    } catch (error) {
        console.error(`[CRITICAL] Error al crear el enlace de cuenta para ${accountId}:`, error);
        throw new HttpsError("internal", error.message || "Ocurrió un error desconocido en la API de Stripe.");
    }
});
