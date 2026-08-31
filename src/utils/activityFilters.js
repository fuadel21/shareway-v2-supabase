export const RIDE_EXPIRATION_GRACE_MINUTES = 120;

const OPEN_ACTIVITY_STATUSES = new Set(['scheduled', 'active', 'in_progress']);
const OPEN_REQUEST_STATUSES = new Set(['pending', 'accepted', 'confirmed', 'on_board', 'requested']);
const CLOSED_ACTIVITY_STATUSES = new Set(['completed', 'cancelled', 'expired', 'rejected']);
const ACCEPTED_REQUEST_STATUSES = new Set(['accepted', 'confirmed', 'on_board']);

const STATUS_ALIASES = {
  canceled: 'cancelled',
  finished: 'completed',
  fulfilled: 'completed',
  declined: 'rejected',
  denied: 'rejected',
  emergency_stopped: 'cancelled',
};

const normalizeRawStatus = (status) => String(status ?? '')
  .trim()
  .toLowerCase()
  .replace(/[\s-]+/g, '_');

/**
 * Keeps the UI's lifecycle vocabulary stable when older records or RPCs use
 * a different spelling/name for a terminal state.
 */
export const normalizeActivityStatus = (status, fallback = '') => {
  const normalized = normalizeRawStatus(status);
  return STATUS_ALIASES[normalized] || normalized || fallback;
};

const isValidDate = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  return !Number.isNaN(date.getTime());
};

export const isPastExpirationGrace = (
  departureTime,
  now = new Date(),
  graceMinutes = RIDE_EXPIRATION_GRACE_MINUTES,
) => {
  if (!departureTime || !isValidDate(departureTime)) return false;

  const departure = departureTime instanceof Date ? departureTime : new Date(departureTime);
  const current = now instanceof Date ? now : new Date(now);
  if (!isValidDate(current)) return false;

  const graceMs = Math.max(0, Number(graceMinutes) || 0) * 60 * 1000;
  return departure.getTime() < current.getTime() - graceMs;
};

const isRequesterActivity = (activity) => activity?.role === 'requester' || Boolean(activity?.request_id);

/**
 * Computes the status that should be used by activity filters and cards.
 * Explicit terminal states always win; only open states can become expired
 * based on departure_time.
 */
export const getEffectiveActivityStatus = (
  activity,
  { now = new Date(), graceMinutes = RIDE_EXPIRATION_GRACE_MINUTES } = {},
) => {
  const isRequester = isRequesterActivity(activity);
  const fallback = isRequester ? 'requested' : 'scheduled';
  const rawStatus = normalizeActivityStatus(activity?.status, fallback);
  const requestStatus = normalizeActivityStatus(
    activity?.request_status || activity?.ride_request_status,
  );
  const parentRideStatus = normalizeActivityStatus(
    activity?.real_ride_status || activity?.parent_ride_status,
  );

  if (isRequester) {
    // A request can be returned by the RPC as status "requested" while the
    // request or its parent ride has already reached a terminal state.
    if (CLOSED_ACTIVITY_STATUSES.has(requestStatus)) return requestStatus;
    if (CLOSED_ACTIVITY_STATUSES.has(parentRideStatus)) return parentRideStatus;

    if (['pending', 'requested'].includes(rawStatus)) {
      return isPastExpirationGrace(activity?.departure_time, now, graceMinutes)
        ? 'expired'
        : 'requested';
    }
  }

  if (CLOSED_ACTIVITY_STATUSES.has(rawStatus)) return rawStatus;
  if (OPEN_ACTIVITY_STATUSES.has(rawStatus)
    && isPastExpirationGrace(activity?.departure_time, now, graceMinutes)) {
    return 'expired';
  }

  return rawStatus;
};

/**
 * Computes a request's display/filter status. Request rows use pending as the
 * default, while fulfilled is the terminal equivalent of a completed match.
 */
export const getEffectiveRequestStatus = (
  request,
  { now = new Date(), graceMinutes = RIDE_EXPIRATION_GRACE_MINUTES } = {},
) => {
  const rawStatus = normalizeActivityStatus(request?.status, 'pending');
  const status = rawStatus === 'requested' ? 'pending' : rawStatus;

  if (CLOSED_ACTIVITY_STATUSES.has(status)) return status;
  if (OPEN_REQUEST_STATUSES.has(status)
    && isPastExpirationGrace(request?.departure_time, now, graceMinutes)) {
    return 'expired';
  }

  return status;
};

export const isClosedActivityStatus = (status) => CLOSED_ACTIVITY_STATUSES.has(
  normalizeActivityStatus(status),
);

export const isAcceptedRequestStatus = (status) => ACCEPTED_REQUEST_STATUSES.has(
  normalizeActivityStatus(status),
);

/**
 * Categories used by the "Mis viajes" activity tabs.
 * History deliberately includes every terminal item for backwards
 * compatibility; dedicated cancelled/expired tabs can still narrow it down.
 */
export const getActivityCategory = (
  activity,
  { now = new Date(), graceMinutes = RIDE_EXPIRATION_GRACE_MINUTES } = {},
) => {
  const status = getEffectiveActivityStatus(activity, { now, graceMinutes });

  if (status === 'expired') return 'expired';
  if (status === 'cancelled' || status === 'rejected') return 'cancelled';
  if (status === 'completed') return 'history';
  if (status === 'requested' || isRequesterActivity(activity)) return 'requested';
  if (OPEN_ACTIVITY_STATUSES.has(status)) return 'active';
  return 'other';
};

export const filterActivityByTab = (
  activities,
  tab,
  { now = new Date(), graceMinutes = RIDE_EXPIRATION_GRACE_MINUTES } = {},
) => (Array.isArray(activities) ? activities : [])
  .map((activity) => ({
    ...activity,
    effective_status: getEffectiveActivityStatus(activity, { now, graceMinutes }),
  }))
  .filter((activity) => {
    const category = getActivityCategory(activity, { now, graceMinutes });

    switch (tab) {
      case 'active':
        return category === 'active';
      case 'requested':
        return category === 'requested';
      case 'history':
        return ['history', 'expired', 'cancelled'].includes(category);
      case 'expired':
        return category === 'expired';
      case 'cancelled':
        return category === 'cancelled';
      default:
        return false;
    }
  });
