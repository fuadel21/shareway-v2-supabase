import { supabase } from '@/lib/supabase.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const QUERY_TIMEOUT_MS = 12000;

const SETTLEMENT_EVENTS = new Set([
  'ride_settlement',
  'no_show_penalty',
  'passenger_cancellation_penalty',
  'driver_cancellation_penalty',
]);

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeDateKey = (date) => {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
};

const makeDailyBuckets = (days = 7) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return Array.from({ length: days }, (_, index) => {
    const date = new Date(today.getTime() - (days - 1 - index) * DAY_MS);
    const key = date.toISOString().slice(0, 10);
    return {
      key,
      name: date.toLocaleDateString('es-ES', { weekday: 'short' }).replace('.', ''),
      profit: 0,
      rides: 0,
      bookings: 0,
      users: 0,
    };
  });
};

const withTimeout = (promise, label) => Promise.race([
  promise,
  new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`${label} timed out after ${QUERY_TIMEOUT_MS}ms`)), QUERY_TIMEOUT_MS);
  }),
]);

const safeSelect = async (table, select, options = {}) => {
  try {
    let query = supabase.from(table).select(select);

    if (options.gte) query = query.gte(options.gte.column, options.gte.value);
    if (options.order) query = query.order(options.order.column, { ascending: options.order.ascending ?? false });
    if (options.limit) query = query.limit(options.limit);

    const { data, error, count } = await withTimeout(query, table);
    if (error) {
      console.warn(`[Admin Metrics] ${table} failed:`, error.message);
      return { data: [], count: 0, error };
    }

    return { data: data || [], count: count ?? data?.length ?? 0, error: null };
  } catch (error) {
    console.warn(`[Admin Metrics] ${table} unavailable:`, error.message);
    return { data: [], count: 0, error };
  }
};

export const getRealAdminMetrics = async ({ days = 7 } = {}) => {
  const safeDays = Math.max(1, Math.min(Number(days) || 7, 31));
  const buckets = makeDailyBuckets(safeDays);
  const bucketMap = new Map(buckets.map((bucket) => [bucket.key, bucket]));
  const since = new Date(Date.now() - safeDays * DAY_MS).toISOString();

  const [ridesRes, ledgerRes, profilesRes, requestsRes] = await Promise.all([
    safeSelect('rides', '*', { gte: { column: 'created_at', value: since }, order: { column: 'created_at', ascending: false }, limit: 5000 }),
    safeSelect('ride_financial_ledger', 'event_type,platform_fee,created_at', { gte: { column: 'created_at', value: since }, order: { column: 'created_at', ascending: false }, limit: 5000 }),
    safeSelect('profiles', 'id,created_at', { gte: { column: 'created_at', value: since }, order: { column: 'created_at', ascending: false }, limit: 5000 }),
    safeSelect('ride_requests', '*', { gte: { column: 'created_at', value: since }, order: { column: 'created_at', ascending: false }, limit: 5000 }),
  ]);

  const rides = ridesRes.data;
  const ledger = ledgerRes.data;
  const profiles = profilesRes.data;
  const requests = requestsRes.data;

  const statusCounts = rides.reduce((acc, ride) => {
    const status = ride.status || 'unknown';
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});

  rides.forEach((ride) => {
    const key = normalizeDateKey(ride.created_at || ride.departure_time);
    const bucket = bucketMap.get(key);
    if (!bucket) return;
    bucket.rides += 1;
  });

  profiles.forEach((profile) => {
    const key = normalizeDateKey(profile.created_at);
    const bucket = bucketMap.get(key);
    if (!bucket) return;
    bucket.users += 1;
  });

  requests.forEach((request) => {
    const key = normalizeDateKey(request.created_at || request.departure_time);
    const bucket = bucketMap.get(key);
    if (!bucket) return;
    bucket.bookings += 1;
  });

  let realizedPlatformFees = 0;
  ledger.forEach((entry) => {
    if (!SETTLEMENT_EVENTS.has(String(entry.event_type || '').toLowerCase())) return;
    const amount = Math.max(toNumber(entry.platform_fee), 0);
    realizedPlatformFees += amount;
    const key = normalizeDateKey(entry.created_at);
    const bucket = bucketMap.get(key);
    if (bucket) bucket.profit += amount;
  });

  // Do not project fees from rides.price. That field is a per-seat offer and
  // cannot prove a charge, a seat count, a refund, or a completed settlement.
  // When the ledger has no event, the truthful value is zero and the dashboard
  // must show that no realized fee was recorded yet.
  const totalProfit = realizedPlatformFees;
  const activeRides = (statusCounts.scheduled || 0) + (statusCounts.active || 0) + (statusCounts.in_progress || 0);
  const sourceHealth = {
    rides: !ridesRes.error,
    walletTransactions: !ledgerRes.error,
    profiles: !profilesRes.error,
    rideRequests: !requestsRes.error,
  };
  const unavailableSources = Object.entries(sourceHealth)
    .filter(([, healthy]) => !healthy)
    .map(([source]) => source);

  return {
    chartData: buckets.map((bucket) => ({
      ...bucket,
      profit: Number(bucket.profit.toFixed(2)),
    })),
    totals: {
      realProfitLastDays: Number(totalProfit.toFixed(2)),
      activeRides,
      scheduledRides: statusCounts.scheduled || 0,
      expiredRides: statusCounts.expired || 0,
      completedRides: statusCounts.completed || 0,
      cancelledRides: (statusCounts.cancelled || 0) + (statusCounts.canceled || 0),
      newUsers: profiles.length,
      rideRequests: requests.length,
      ridesCreated: rides.length,
      usedEstimatedProfit: false,
    },
    sources: {
      rides: rides.length,
      walletTransactions: ledger.length,
      profiles: profiles.length,
      rideRequests: requests.length,
    },
    sourceHealth,
    unavailableSources,
    isPartial: unavailableSources.length > 0,
  };
};
