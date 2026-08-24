const PENDING_STATUSES = new Set(['pending', 'requested']);
const OPEN_DRIVER_STATUSES = new Set(['scheduled', 'active', 'in_progress']);

export const countPendingOnRide = (ride) => {
    const directCount = Number(
        ride?.pending_requests_count
        ?? ride?.request_count
        ?? ride?.requests_count
        ?? 0
    );
    if (Number.isFinite(directCount) && directCount > 0) return directCount;

    const collections = [
        Array.isArray(ride?.passengers) ? ride.passengers : [],
        Array.isArray(ride?.requests) ? ride.requests : [],
        Array.isArray(ride?.ride_requests) ? ride.ride_requests : [],
    ];

    return collections.reduce((total, list) => (
        total + list.filter((item) => PENDING_STATUSES.has(String(item?.status || '').toLowerCase())).length
    ), 0);
};

export const isDriverRide = (ride, userId) => {
    if (!ride || !userId) return false;
    if (String(ride.driver_id || '') === String(userId)) return true;
    return ride.role === 'driver';
};

export const buildDriverPendingInbox = (rides = [], userId) => {
    return (Array.isArray(rides) ? rides : [])
        .filter((ride) => isDriverRide(ride, userId))
        .filter((ride) => OPEN_DRIVER_STATUSES.has(String(ride?.status || 'scheduled')))
        .map((ride) => {
            const pendingCount = countPendingOnRide(ride);
            if (pendingCount <= 0) return null;
            return {
                id: ride.id,
                origin: ride.origin,
                destination: ride.destination,
                departure_time: ride.departure_time,
                pendingCount,
                status: ride.status,
            };
        })
        .filter(Boolean)
        .sort((a, b) => new Date(a.departure_time || 0) - new Date(b.departure_time || 0));
};

export const getActivityStatPath = (key) => ({
    activeRides: '/my-rides?tab=active',
    pendingRequests: '/my-rides?tab=active',
    openRequests: '/my-requests',
    pendingPayments: '/wallet',
}[key] || '/my-rides');
