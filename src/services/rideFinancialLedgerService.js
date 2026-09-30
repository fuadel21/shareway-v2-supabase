import { supabase } from '@/lib/supabase.js';

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const getRideFinancialLedger = async ({ limit = 50 } = {}) => {
  const { data, error } = await supabase
    .from('ride_financial_ledger')
    .select(`
      *,
      ride:rides(id, origin, destination, departure_time, status),
      actor:profiles!actor_user_id(display_name, email)
    `)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;

  return (data || []).map((entry) => ({
    ...entry,
    gross_amount: toNumber(entry.gross_amount),
    platform_fee: toNumber(entry.platform_fee),
    driver_amount: toNumber(entry.driver_amount),
    refund_amount: toNumber(entry.refund_amount),
    net_amount: toNumber(entry.net_amount),
  }));
};

const COLLECTION_EVENTS = new Set(['booking_hold', 'booking_paid']);
const SETTLEMENT_EVENTS = new Set(['ride_settlement', 'no_show_penalty']);
const PENALTY_EVENTS = new Set(['passenger_cancellation_penalty', 'driver_cancellation_penalty']);
const REFUND_EVENTS = new Set(['passenger_refund', 'driver_cancellation_refund', 'booking_payment_refund', 'refund']);

const categoryFor = (eventType) => {
  const normalized = String(eventType || '').toLowerCase();
  if (COLLECTION_EVENTS.has(normalized)) return 'collection';
  if (REFUND_EVENTS.has(normalized) || normalized.includes('refund')) return 'refund';
  if (PENALTY_EVENTS.has(normalized)) return 'penalty';
  if (SETTLEMENT_EVENTS.has(normalized)) return 'settlement';
  return 'other';
};

export const summarizeRideFinancialLedger = (entries = []) => entries.reduce((acc, entry) => {
  const category = categoryFor(entry.event_type);
  const gross = toNumber(entry.gross_amount);
  const platformFee = toNumber(entry.platform_fee);
  const driverAmount = toNumber(entry.driver_amount);
  const refund = toNumber(entry.refund_amount);

  // Ledger entries are lifecycle events. A booking payment/hold and its later
  // settlement repeat the same gross, so they must not be added to one total.
  if (category === 'collection') acc.collections += gross;
  if (category === 'settlement') {
    acc.settledGross += gross;
    acc.platformFee += platformFee;
    acc.driverAmount += driverAmount;
  }
  if (category === 'penalty') {
    acc.penalties += gross;
    acc.platformFee += platformFee;
    acc.driverAmount += driverAmount;
  }
  if (category === 'refund') acc.refunds += refund;
  acc.count += 1;
  return acc;
}, {
  collections: 0,
  settledGross: 0,
  penalties: 0,
  platformFee: 0,
  driverAmount: 0,
  refunds: 0,
  count: 0,
});
