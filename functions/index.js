require('dotenv').config();
const functions = require('firebase-functions');
const admin = require("firebase-admin");
admin.initializeApp();

const { onCall } = require("firebase-functions/v2/https");
const { onDocumentUpdated } = require("firebase-functions/v2/firestore");

// --- MÓDULOS DE FUNCIONES ---
const bookings = require("./src/bookings");
const notifications = require("./src/notifications");
const rideRequests = require("./src/rideRequests");
const rides = require("./src/rides");
const payments = require("./src/payments");
const users = require("./src/users");
const wallet = require("./src/wallet");
const chat = require("./src/chat");
const cron = require("./src/cron");
const platform = require("./src/platform");

const REGION = "us-central1";

// ================================================================================================
// === TAREAS PROGRAMADAS (CRON JOBS) ===
// ================================================================================================

exports.hourlyCleanup = cron.hourlyCleanup;

// ================================================================================================
// === TRIGGERS (DISPARADORES) ===
// ================================================================================================

exports.onUserCreate = functions.region(REGION).auth.user().onCreate(async (user) => {
    // ... (código existente)
});

exports.onRideUpdated = onDocumentUpdated({ document: "rides/{rideId}", region: REGION }, async (event) => {
    await payments.handleRideCompletion(event);
});

exports.syncUserRole = users.syncUserRole;

// ================================================================================================
// === FUNCIONES LLAMABLES (CALLABLE) ===
// ================================================================================================

// -- Plataforma (Admin) --
exports.getPlatformStats = platform.getPlatformStats;
exports.requestPlatformPayout = platform.requestPlatformPayout; // --- Añadido ---

// -- Usuarios --
exports.updateUserProfile = users.updateUserProfile;

// -- Pagos --
exports.addFunds = payments.addFunds;
exports.requestPayout = payments.requestPayout;

// -- Wallet --
exports.releaseHeldFunds = wallet.releaseHeldFunds;

// -- Chat --
exports.getOrCreateChat = chat.getOrCreateChat;

// -- Solicitudes de Viaje (Pasajeros) --
exports.createRideRequest = rideRequests.createRideRequest;
exports.cancelRideRequest = rideRequests.cancelRideRequest;
exports.acceptRequest = rideRequests.acceptRequest;

// -- Viajes y Reservas --
exports.createRide = rides.createRide;
exports.confirmTripAndPay = rides.confirmTripAndPay;
exports.cancelBookingAndRefund = bookings.cancelBookingAndRefund;

// -- GESTIÓN DEL CICLO DE VIDA DEL VIAJE --
exports.startRide = rides.startRide;
exports.completeRide = rides.completeRide;
exports.cancelRide = rides.cancelRide;
