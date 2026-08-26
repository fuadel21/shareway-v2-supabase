const UNRESOLVED_PIN_STATUSES = new Set([
    'confirmed',
    'accepted',
    'pending_boarding',
]);

const UNPAID_PASSENGER_STATUSES = new Set([
    'pending',
    'requested',
    'awaiting_payment',
    'processing',
    'unpaid',
]);

const UNPAID_PAYMENT_STATUSES = new Set([
    'unpaid',
    'pending',
    'failed',
    'requires_payment',
    'awaiting_payment',
    'processing',
    'incomplete',
]);

const UNPAID_REQUEST_STATUSES = new Set([
    'pending',
    'requested',
    'awaiting_payment',
    'processing',
    'unpaid',
]);

const asStatus = (value) => String(value || '').trim().toLowerCase();

export const normalizeBoardingPin = (value) => String(value || '').replace(/\D/g, '').slice(0, 8);

export const getPassengerStatus = (passenger) => asStatus(passenger?.status);

export const isPassengerPaid = (passenger) => {
    const status = getPassengerStatus(passenger);
    if (UNPAID_PASSENGER_STATUSES.has(status)) return false;

    const paymentStatus = asStatus(
        passenger?.payment_status
        || passenger?.paymentStatus
        || passenger?.paid_status
    );
    if (paymentStatus && UNPAID_PAYMENT_STATUSES.has(paymentStatus)) return false;
    if (passenger?.paid === false || passenger?.is_paid === false) return false;

    return true;
};

export const needsPinVerification = (passenger) => {
    if (!passenger || !isPassengerPaid(passenger)) return false;
    return UNRESOLVED_PIN_STATUSES.has(getPassengerStatus(passenger));
};

export const countPendingUnpaidRequests = (ride = {}) => {
    const directCount = Number(
        ride.unpaid_request_count
        ?? ride.pending_unpaid_count
        ?? ride.pending_requests_count
        ?? ride.request_count
        ?? ride.requests_count
        ?? 0
    );
    if (Number.isFinite(directCount) && directCount > 0) return directCount;

    const lists = [
        ...(Array.isArray(ride.requests) ? ride.requests : []),
        ...(Array.isArray(ride.ride_requests) ? ride.ride_requests : []),
        ...(Array.isArray(ride.unpaid_requests) ? ride.unpaid_requests : []),
    ];

    return lists.filter((request) => UNPAID_REQUEST_STATUSES.has(asStatus(request?.status))).length;
};

export const getBoardingSummary = (ride = {}, readiness = null) => {
    const passengers = Array.isArray(ride?.passengers) ? ride.passengers : [];
    const unpaidPassengers = passengers.filter((passenger) => !isPassengerPaid(passenger));
    const unresolvedPinPassengers = passengers.filter(needsPinVerification);
    const unpaidRequestCount = Number.isFinite(Number(readiness?.unpaid_request_count))
        ? Number(readiness.unpaid_request_count)
        : countPendingUnpaidRequests(ride);

    const unresolvedFromReadiness = Array.isArray(readiness?.unresolved_passengers)
        ? readiness.unresolved_passengers
        : unresolvedPinPassengers;

    const unresolvedCount = Number.isFinite(Number(readiness?.unresolved_count))
        ? Number(readiness.unresolved_count)
        : unresolvedFromReadiness.length;

    const unpaidCount = unpaidPassengers.length + unpaidRequestCount;
    const readyFromData = unresolvedCount === 0 && unpaidCount === 0;
    const ready = readiness?.unavailable
        ? false
        : (typeof readiness?.ready === 'boolean' ? readiness.ready && unpaidCount === 0 : readyFromData);

    return {
        ready,
        unpaidCount,
        unpaidRequestCount,
        unpaidPassengers,
        unresolvedCount,
        unresolvedPinPassengers: unresolvedFromReadiness,
        verifiedCount: Number(readiness?.verified_count || passengers.filter((passenger) =>
            ['verified', 'completed', 'on_board'].includes(getPassengerStatus(passenger))
        ).length),
    };
};

export const getStartBlockReason = ({ ride, now = new Date(), readiness = null } = {}) => {
    const status = asStatus(ride?.status);
    if (status !== 'scheduled') return 'El viaje no está programado.';

    const departure = new Date(ride?.departure_time || ride?.departureTime);
    const hasValidDeparture = Number.isFinite(departure.getTime());
    if (!hasValidDeparture) return 'Falta la hora de salida.';

    const minutesToDeparture = (departure.getTime() - now.getTime()) / 60000;
    if (minutesToDeparture > 15) return 'Disponible 15 min antes';
    if (minutesToDeparture < -120) return 'El viaje ha expirado.';

    const summary = getBoardingSummary(ride, readiness);
    if (readiness?.unavailable) {
        return readiness.error || 'No se pudo comprobar el embarque.';
    }
    if (summary.unpaidCount > 0) {
        return summary.unpaidCount === 1
            ? 'Hay 1 reserva sin pagar'
            : `Hay ${summary.unpaidCount} reservas sin pagar`;
    }
    if (summary.unresolvedCount > 0) {
        return summary.unresolvedCount === 1
            ? 'Falta verificar el PIN'
            : `Faltan ${summary.unresolvedCount} PIN por verificar`;
    }
    if (summary.ready !== true) {
        return 'Debes verificar el PIN o resolver el no-show antes de iniciar.';
    }
    return null;
};

export const canPresentStartRide = ({ ride, now = new Date(), readiness = null } = {}) =>
    getStartBlockReason({ ride, now, readiness }) === null;
