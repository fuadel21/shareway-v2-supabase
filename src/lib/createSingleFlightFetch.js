const DEFAULT_CRITICAL_RPCS = new Set([
  'confirm_trip_and_pay',
  'confirm_stripe_booking',
  'create_ride',
  'fulfill_ride_request',
  'start_ride',
  'complete_ride',
  'cancel_ride',
  'cancel_booking_and_refund',
  'accept_passenger',
  'reject_passenger',
  'remove_passenger',
  'verify_passenger_boarding',
  'handle_passenger_no_show',
  'complete_passenger_dropoff',
  'trigger_emergency_alert',
  'add_funds',
  'request_payout',
  'request_platform_payout',
  'process_payout',
]);

const getMethod = (input, init) => String(
  init?.method || (typeof Request !== 'undefined' && input instanceof Request ? input.method : 'GET')
).toUpperCase();

const getUrl = (input) => {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input?.url || '';
};

const getRpcName = (url) => {
  try {
    const pathname = new URL(url, 'https://shareway.local').pathname;
    const marker = '/rest/v1/rpc/';
    const index = pathname.indexOf(marker);
    if (index === -1) return null;
    return decodeURIComponent(pathname.slice(index + marker.length).split('/')[0] || '');
  } catch {
    return null;
  }
};

const readBody = async (input, init) => {
  if (typeof init?.body === 'string') return init.body;
  if (init?.body != null) return String(init.body);

  if (typeof Request !== 'undefined' && input instanceof Request) {
    try {
      return await input.clone().text();
    } catch {
      return '';
    }
  }

  return '';
};

/**
 * Collapses concurrent identical critical RPC requests into one network call.
 * Each caller receives its own Response clone, so Supabase can consume it safely.
 *
 * This protects against double taps and against safeCall retrying while the first
 * timed-out HTTP request is still running on the server.
 */
export const createSingleFlightFetch = (
  baseFetch = globalThis.fetch,
  { criticalRpcs = DEFAULT_CRITICAL_RPCS } = {},
) => {
  if (typeof baseFetch !== 'function') {
    throw new TypeError('createSingleFlightFetch requires a fetch implementation');
  }

  const inFlight = new Map();

  return async (input, init) => {
    const method = getMethod(input, init);
    const url = getUrl(input);
    const rpcName = method === 'POST' ? getRpcName(url) : null;

    if (!rpcName || !criticalRpcs.has(rpcName)) {
      return baseFetch(input, init);
    }

    const body = await readBody(input, init);
    const key = `${method}:${rpcName}:${body}`;

    let requestPromise = inFlight.get(key);
    if (!requestPromise) {
      requestPromise = Promise.resolve(baseFetch(input, init));
      inFlight.set(key, requestPromise);
      requestPromise.finally(() => {
        if (inFlight.get(key) === requestPromise) inFlight.delete(key);
      });
    }

    const response = await requestPromise;
    return typeof response?.clone === 'function' ? response.clone() : response;
  };
};

export const CRITICAL_SUPABASE_RPCS = DEFAULT_CRITICAL_RPCS;
