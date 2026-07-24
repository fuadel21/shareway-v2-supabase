import { supabase } from './supabase.js';

const ACTIVE_PASSENGER_STATUSES = new Set([
  'confirmed',
  'accepted',
  'pending_boarding',
  'verified',
  'completed',
]);

const passengerId = (passenger) => String(
  typeof passenger === 'string'
    ? passenger
    : passenger?.id ?? passenger?.user_id ?? passenger?.passenger_id ?? '',
);

const passengerIsEligible = (passenger) => {
  if (typeof passenger === 'string') return true;
  const status = String(passenger?.status ?? '').toLowerCase();
  return !status || ACTIVE_PASSENGER_STATUSES.has(status);
};

export const getRideReviewParticipantIds = (ride) => {
  const ids = new Set();
  if (ride?.driver_id) ids.add(String(ride.driver_id));

  for (const id of Array.isArray(ride?.participant_ids) ? ride.participant_ids : []) {
    if (id) ids.add(String(id));
  }

  for (const passenger of Array.isArray(ride?.passengers) ? ride.passengers : []) {
    const id = passengerId(passenger);
    if (id && passengerIsEligible(passenger)) ids.add(id);
  }

  return ids;
};

export const validatePostRideReviewAccess = ({ ride, reviewerId, revieweeId }) => {
  if (!ride) return { allowed: false, reason: 'Viaje no encontrado.' };
  if (!reviewerId) return { allowed: false, reason: 'Sesión no válida.' };
  if (!revieweeId) return { allowed: false, reason: 'Usuario a valorar no válido.' };
  if (String(reviewerId) === String(revieweeId)) {
    return { allowed: false, reason: 'No puedes valorarte a ti mismo.' };
  }
  if (String(ride.status || '').toLowerCase() !== 'completed') {
    return { allowed: false, reason: 'Solo puedes valorar después de completar el viaje.' };
  }

  const participants = getRideReviewParticipantIds(ride);
  if (!participants.has(String(reviewerId))) {
    return { allowed: false, reason: 'No participaste en este viaje.' };
  }
  if (!participants.has(String(revieweeId))) {
    return { allowed: false, reason: 'El usuario indicado no participó en este viaje.' };
  }

  return { allowed: true, reason: null };
};

export const fetchPostRideReviewAccess = async ({ rideId, reviewerId, revieweeId }) => {
  if (!rideId) return { allowed: false, reason: 'Viaje no válido.', ride: null };
  if (!reviewerId) return { allowed: false, reason: 'Sesión no válida.', ride: null };
  if (!revieweeId) return { allowed: false, reason: 'Usuario a valorar no válido.', ride: null };

  const { data, error } = await supabase.rpc('get_post_ride_review_access', {
    p_ride_id: rideId,
    p_reviewee_id: revieweeId,
  });

  if (error) throw error;
  const result = Array.isArray(data) ? data[0] : data;
  return {
    allowed: result?.allowed === true,
    reason: result?.reason ?? (result?.allowed ? null : 'Valoración no disponible.'),
    ride: result?.ride_id ? {
      id: result.ride_id,
      status: result.ride_status,
      completed_at: result.completed_at,
    } : null,
  };
};
