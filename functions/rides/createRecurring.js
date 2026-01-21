const { onCall } = require("firebase-functions/v2/https");
const { getFirestore, GeoPoint } = require("firebase-admin/firestore");
const { logger } = require("firebase-functions");
const { v4: uuidv4 } = require('uuid');

exports.createRecurringRide = onCall(async (request) => {
    if (!request.auth) {
        throw new Error("Usuario no autenticado.");
    }

    const db = getFirestore();
    const uid = request.auth.uid;

    // --- LÓGICA DE SEGURIDAD MEJORADA ---
    // 1. Obtenemos el perfil del conductor desde Firestore para evitar falsificaciones.
    const userDoc = await db.collection('users').doc(uid).get();
    if (!userDoc.exists) {
        throw new Error("No se encontró el perfil del conductor.");
    }
    const driverInfo = userDoc.data();

    const driver = {
        id: uid,
        name: driverInfo.name,
        photoURL: driverInfo.photoURL
    };

    const { rideData, repeatDays, repeatUntil } = request.data;
    // 2. Incluimos el campo 'isWomenOnly' en la lógica.
    const { origin, destination, dateTime, seats, price, communityId, communityName, isWomenOnly } = rideData;
    
    // 3. Validación de entradas más robusta.
    if (!origin || !destination || !dateTime || !seats || !price || !repeatDays || !repeatUntil) {
        throw new Error("Faltan datos esenciales para crear los viajes recurrentes.");
    }
    if (!origin.coordinates?.lat || !destination.coordinates?.lng) {
        throw new Error("Las coordenadas de origen o destino no son válidas.");
    }
    if (price < 0 || seats <= 0) {
        throw new Error("El precio y el número de asientos deben ser positivos.");
    }

    const startDate = new Date(dateTime);
    const endDate = new Date(repeatUntil);
    const selectedDays = repeatDays.map(Number);
    const recurringId = uuidv4();

    const ridesToCreate = [];
    let currentDate = new Date(startDate);

    while (currentDate <= endDate) {
        const currentDayOfWeek = currentDate.getDay();
        
        if (selectedDays.includes(currentDayOfWeek)) {
            const newRide = {
                price: price,
                seatsAvailable: seats,
                origin: {
                    address: origin.address,
                },
                destination: {
                    address: destination.address,
                },
                originCoords: new GeoPoint(origin.coordinates.lat, origin.coordinates.lng),
                destinationCoords: new GeoPoint(destination.coordinates.lat, destination.coordinates.lng),
                driver: driver,
                passengers: [],
                status: 'scheduled',
                createdAt: new Date(),
                dateTime: new Date(currentDate),
                communityId: communityId || null,
                communityName: communityName || null,
                recurringId: recurringId,
                isWomenOnly: isWomenOnly || false, // <-- Campo añadido
            };
            ridesToCreate.push(newRide);
        }

        currentDate.setDate(currentDate.getDate() + 1);
    }

    if (ridesToCreate.length > 0 && ridesToCreate.length <= 400) {
        const batch = db.batch();

        ridesToCreate.forEach(ride => {
            const rideRef = db.collection('rides').doc();
            batch.set(rideRef, ride);
        });

        await batch.commit();
        
        return { 
            success: true, 
            message: `¡Se han publicado ${ridesToCreate.length} viajes recurrentes!` 
        };
    } else if (ridesToCreate.length > 400) {
        throw new Error(`Demasiados viajes (${ridesToCreate.length}). El límite es 400 por operación.`);
    } else {
         return { 
            success: false, 
            message: "No se crearon viajes. Asegúrate de que las fechas y los días seleccionados son correctos." 
        };
    }
});
