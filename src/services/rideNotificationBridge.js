import {
  acceptPassenger,
  cancelBooking,
  cancelRide,
  rejectPassenger,
  submitReview,
} from './rideService.js';
import {
  notifyReviewReceived,
  notifyRideCancelled,
  notifyRideRequestAccepted,
  notifyRideRequestRejected,
} from './notificationEvents.js';
import { fetchPostRideReviewAccess } from '../lib/postRideReviewAccess.js';

const getRideOrigin = (ride) => ride?.origin_address || ride?.origin?.address || ride?.origin?.name || '';
const getRideDestination = (ride) => ride?.destination_address || ride?.destination?.address || ride?.destination?.name || '';

const getDriverName = (ride, fallback = 'El conductor') => (
  ride?.driver?.display_name || ride?.driver_name || ride?.driverDisplayName || fallback
);

const getPassengerId = (passenger) => (
  typeof passenger === 'string' ? passenger : passenger?.id || passenger?.user_id || passenger?.passenger_id
);

const getPassengerName = (passenger, fallback = 'Pasajero') => (
  typeof passenger === 'string' ? fallback : passenger?.displayName || passenger?.display_name || passenger?.name || fallback
);

const getRidePassengers = (ride) => {
  if (!ride) return [];
  if (Array.isArray(ride.passengers)) return ride.passengers;
  if (Array.isArray(ride.bookings)) return ride.bookings;
  if (Array.isArray(ride.confirmed_passengers)) return ride.confirmed_passengers;
  return [];
};

export const acceptPassengerAndNotify = async ({ rideId, passenger, ride = null, driver = null }) => {
  const passengerId = getPassengerId(passenger);
  const result = await acceptPassenger(rideId, passengerId);

  await notifyRideRequestAccepted({
    passengerId,
    driverId: driver?.id || ride?.driver_id || ride?.driver?.id,
    rideId,
    driverName: driver?.display_name || getDriverName(ride),
  });

  return result;
};

export const rejectPassengerAndNotify = async ({ rideId, passenger, ride = null, driver = null }) => {
  const passengerId = getPassengerId(passenger);
  const result = await rejectPassenger(rideId, passengerId);

  await notifyRideRequestRejected({
    passengerId,
    driverId: driver?.id || ride?.driver_id || ride?.driver?.id,
    rideId,
    driverName: driver?.display_name || getDriverName(ride),
  });

  return result;
};

export const cancelRideAndNotify = async ({ rideId, ride = null, reason = '' }) => {
  const result = await cancelRide(rideId, reason);
  const actorId = ride?.driver_id || ride?.driver?.id || null;
  const origin = getRideOrigin(ride);
  const destination = getRideDestination(ride);

  await Promise.allSettled(
    getRidePassengers(ride)
      .map((passenger) => getPassengerId(passenger))
      .filter(Boolean)
      .map((userId) => notifyRideCancelled({
        userId,
        actorId,
        rideId,
        origin,
        destination,
        reason,
      }))
  );

  return result;
};

export const cancelBookingAndNotifyDriver = async ({ rideId, ride = null, passenger = null, reason = '' }) => {
  const result = await cancelBooking(rideId);
  const driverId = ride?.driver_id || ride?.driver?.id;

  if (driverId) {
    await notifyRideCancelled({
      userId: driverId,
      actorId: getPassengerId(passenger),
      rideId,
      origin: getRideOrigin(ride),
      destination: getRideDestination(ride),
      reason: reason || `${getPassengerName(passenger)} ha cancelado su reserva.`,
    });
  }

  return result;
};

export const submitReviewAndNotify = async ({ rideId, revieweeId, rating, comment, reviewer = null }) => {
  const access = await fetchPostRideReviewAccess({
    rideId,
    reviewerId: reviewer?.id,
    revieweeId,
  });

  if (!access.allowed) throw new Error(access.reason || 'Valoración no permitida.');

  const result = await submitReview({ rideId, revieweeId, rating, comment });

  await notifyReviewReceived({
    revieweeId,
    reviewerId: reviewer?.id,
    rideId,
    rating,
    reviewerName: reviewer?.display_name || reviewer?.displayName || 'Un usuario',
  });

  return result;
};
