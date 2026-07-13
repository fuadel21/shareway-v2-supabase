import { supabase } from '@/lib/supabase.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const PLATFORM_FEE_RATE = 0.10;

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

const safeSelect = async (table, select, options = {}) => {
  let query = supabase.from(table).select(select);

  if (options.gte) query = query.gte(options.gte.column, options.gte.value);
  if (options.order) query = query.order(options.order.column, { ascending: options.order.ascending ?? false });
  if (options.limit) query = query.limit(options.limit);

  const { data, error, count } = await query;
  if (error) {
    console.warn(`[Admin Metrics] ${table} failed:`, error.message);
    return { data: [], count: 0, error };
  }

  return { data: data || [], count: count ?? data?.length ?? 0, error: null };
};

const isPlatformFeeTransaction = (transaction) => {
  const searchable = [
    transaction.type,
    transaction.transaction_type,
    transaction.category,
    transaction.description,
    transaction.reason,
    JSON.stringify(transaction.metadata || {}),
  ].filter(Boolean).join(' ').toLowerCase();

  return searchable.includes('platform')
    || searchable.includes('fee')
    || searchable.includes('commission')
    || searchable.includes('comision')
    || searchable.includes('comisión');
};

export const getRealAdminMetrics = async ({ days = 7 } = {}) => {
  const buckets = makeDailyBuckets(days);
  const bucketMap = new Map(buckets.map((bucket) => [bucket.key, bucket]));
  const since = new Date(Date.now() - days * DAY_MS).toISOString();

  const [ridesRes, transactionsRes, profilesRes, requestsRes] = await Promise.all([
    safeSelect('rides', '*', { gte: { column: 'created_at', value: since }, order: { column: 'created_at', ascending: false }, limit: 5000 }),
    safeSelect('wallet_transactions', '*', { gte: { column: 'created_at', value: since }, order: { column: 'created_at', ascending: false }, limit: 5000 }),
    safeSelect('profiles', 'id,created_at', { gte: { column: 'created_at', value: since }, order: { column: 'created_at', ascending: false }, limit: 5000 }),
    safeSelect('ride_requests', '*', { gte: { column: 'created_at', value: since }, order: { column: 'created_at', ascending: false }, limit: 5000 }),
  ]);

  const rides = ridesRes.data;
  const transactions = transactionsRes.data;
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

  let realFeeTotal = 0;
  transactions.forEach((transaction) => {
    if (!isPlatformFeeTransaction(transaction)) return;
    const amount = Math.abs(toNumber(transaction.amount));
    realFeeTotal += amount;
    const key = normalizeDateKey(transaction.created_at);
    const bucket = bucketMap.get(key);
    if (bucket) bucket.profit += amount;
  });

  const estimatedFeeTotal = realFeeTotal > 0
    ? 0
    : rides
      .filter((ride) => ['completed', 'in_progress', 'active'].includes(ride.status))
      .reduce((sum, ride) => sum + (toNumber(ride.price) * PLATFORM_FEE_RATE), 0);

  if (realFeeTotal === 0) {
    rides
      .filter((ride) => ['completed', 'in_progress', 'active'].includes(ride.status))
      .forEach((ride) => {
        const key = normalizeDateKey(ride.created_at || ride.departure_time);
        const bucket = bucketMap.get(key);
        if (bucket) bucket.profit += toNumber(ride.price) * PLATFORM_FEE_RATE;
      });
  }

  const totalProfit = realFeeTotal || estimatedFeeTotal;
  const activeRides = (statusCounts.scheduled || 0) + (statusCounts.active || 0) + (statusCounts.in_progress || 0);

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
      usedEstimatedProfit: realFeeTotal === 0,
    },
    sources: {
      rides: rides.length,
      walletTransactions: transactions.length,
      profiles: profiles.length,
      rideRequests: requests.length,
    },
  };
};
