const { onRequest, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const REGION = "us-central1";
const db = admin.firestore();

const creditPackages = {
    'price_1': { amount: 500, credits: 5 },
    'price_2': { amount: 1000, credits: 10 },
    'price_3': { amount: 2500, credits: 25 },
    'price_4': { amount: 5000, credits: 50 },
};

// --- CORREGIDO: Manejo manual y explícito de CORS ---
exports.createCreditPurchaseIntent = onRequest({ region: REGION }, async (req, res) => {
    // Configurar cabeceras CORS manualmente para permitir cualquier origen
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    // Responder a las solicitudes preflight (OPTIONS)
    if (req.method === 'OPTIONS') {
        return res.status(204).send('');
    }

    if (req.method !== 'POST') {
        return res.status(405).send('Method Not Allowed');
    }

    const idToken = req.headers.authorization?.split('Bearer ')[1];
    if (!idToken) {
        return res.status(401).json({ error: { message: 'Unauthorized: No token provided' } });
    }

    let decodedToken;
    try {
        decodedToken = await admin.auth().verifyIdToken(idToken);
    } catch (error) {
        return res.status(401).json({ error: { message: 'Unauthorized: Invalid token' } });
    }

    const uid = decodedToken.uid;
    const { packageId } = req.body.data; 

    const selectedPackage = creditPackages[packageId];
    if (!selectedPackage) {
        return res.status(400).json({ error: { message: 'El paquete de créditos no es válido.' } });
    }

    try {
        const paymentIntent = await stripe.paymentIntents.create({
            amount: selectedPackage.amount,
            currency: "eur",
            metadata: { userId: uid, credits: selectedPackage.credits, packageId: packageId },
        });
        res.status(200).json({ data: { clientSecret: paymentIntent.client_secret } });
    } catch (error) {
        console.error("Error al crear el Payment Intent para créditos:", error);
        res.status(500).json({ error: { message: 'No se pudo iniciar el proceso de pago.' } });
    }
});


exports.creditPurchaseWebhook = onRequest({ region: REGION, cors: true }, async (req, res) => {
    const sig = req.headers['stripe-signature'];
    const endpointSecret = process.env.STRIPE_CREDITS_WEBHOOK_SECRET;
    if (!endpointSecret) {
        console.error("El secreto del webhook de créditos no está configurado.");
        return res.status(500).send("Configuración de servidor incompleta.");
    }
    let event;
    try {
        event = stripe.webhooks.constructEvent(req.rawBody, sig, endpointSecret);
    } catch (err) {
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }
    if (event.type === 'payment_intent.succeeded') {
        const paymentIntent = event.data.object;
        const { userId, credits } = paymentIntent.metadata;
        if (userId && credits) {
            const userRef = db.collection('users').doc(userId);
            try {
                await userRef.update({ credits: admin.firestore.FieldValue.increment(parseInt(credits, 10)) });
                console.log(`Créditos añadidos: ${credits} al usuario ${userId}.`);
            } catch (error) {
                console.error("Error al actualizar los créditos del usuario:", error);
                return res.status(500).send("Error interno al actualizar los créditos.");
            }
        }
    }
    res.status(200).send();
});
