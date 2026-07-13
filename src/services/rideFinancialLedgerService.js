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

export const summarizeRideFinancialLedger = (entries = []) => entries.reduce((acc, entry) => {
  acc.gross += toNumber(entry.gross_amount);
  acc.platformFee += toNumber(entry.platform_fee);
  acc.driverAmount += toNumber(entry.driver_amount);
  acc.refunds += toNumber(entry.refund_amount);
  acc.net += toNumber(entry.net_amount);
  acc.count += 1;
  return acc;
}, {
  gross: 0,
  platformFee: 0,
  driverAmount: 0,
  refunds: 0,
  net: 0,
  count: 0,
});
