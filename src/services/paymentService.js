/**
 * Servicio de Pagos y Transacciones v3.0
 */
import { supabase } from '@/lib/supabase';
import { safeCall } from '@/lib/supabaseRPC';

/**
 * Legacy arbitrary user-to-user payments are intentionally unavailable.
 * Ride payments must go through confirm_trip_and_pay (wallet) or the Stripe
 * booking PaymentIntent + webhook flow so the server can derive the ride,
 * quote, seats and commission.
 */
export const processPayment = async () => {
  throw new Error('LEGACY_PAYMENT_FLOW_DISABLED: usa el flujo de reserva del viaje.');
};

/**
 * Legacy transaction-id refunds are intentionally unavailable. Refunds must be
 * initiated by the canonical booking/ride cancellation flow, which validates
 * the stored passenger amount and Stripe payment before recording the refund.
 */
export const refundPayment = async () => {
  throw new Error('LEGACY_REFUND_FLOW_DISABLED: usa la cancelación de la reserva o del viaje.');
};

/**
 * Obtiene el saldo actual de la wallet
 */
export const getWalletBalance = async (userId) => {
  const { data, error } = await supabase
    .from('wallets')
    .select('balance, currency')
    .eq('user_id', userId)
    .single();

  if (error) throw error;
  return Number(data?.balance ?? 0);
};

/**
 * Starts a wallet top-up. The client receives a PaymentIntent only; the
 * Stripe webhook performs the actual wallet credit after verifying the event.
 */
export const addFunds = async (addFundsData) => {
  const payload = typeof addFundsData === 'number'
    ? { amount: addFundsData }
    : (addFundsData || {});
  const amount = Number(payload.amount);
  const packageId = typeof payload.packageId === 'string' ? payload.packageId : null;
  const idempotencyKey = payload.idempotencyKey
    || globalThis.crypto?.randomUUID?.()
    || `wallet-topup-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const { data, success, error } = await safeCall(
    () => supabase.functions.invoke('create-payment-intent', {
      body: { amount, packageId, idempotencyKey },
    }),
    'create-payment-intent'
  );

  if (!success) throw new Error(error || 'Error al iniciar la recarga');
  if (data?.error) throw new Error(String(data.error));
  return data;
};

/**
 * Retira fondos de la wallet
 */
export const withdrawFunds = async (withdrawFundsData) => {
  const { amount } = withdrawFundsData || {};
  const idempotencyKey = globalThis.crypto?.randomUUID?.()
    || `payout-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const { data, success, error } = await safeCall(
    () => supabase.functions.invoke('request-payout', {
      body: { amount, idempotencyKey },
    }),
    'request-payout'
  );

  if (!success) throw new Error(error || data?.error || 'Error al solicitar el retiro');
  if (data?.error) throw new Error(String(data.error));
  return data;
};

/**
 * Obtiene el historial de transacciones
 */
export const getTransactionHistory = async (userId, filters = {}) => {
  const { limit = 50, startDate, endDate } = filters;

  let query = supabase
    .from('transactions')
    .select('*')
    .eq('user_id', userId);

  if (startDate) query = query.gte('created_at', startDate.toISOString ? startDate.toISOString() : startDate);
  if (endDate) query = query.lte('created_at', endDate.toISOString ? endDate.toISOString() : endDate);

  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data;
};

/**
 * Valida un pago antes de procesarlo
 */
export const validatePayment = async (paymentData) => {
  const { userId, amount, fromUserId } = paymentData || {};
  const targetId = userId || fromUserId;
  const requestedAmount = Number(amount);

  if (!targetId || !Number.isFinite(requestedAmount) || requestedAmount <= 0) {
    return { valid: false, canPay: false, shortfall: 0 };
  }

  // This helper is only a UI pre-check. The canonical booking RPC re-reads the
  // wallet and quote under lock; never treat this response as authorization to
  // move money.
  const balance = Number(await getWalletBalance(targetId));
  if (balance < requestedAmount) {
    return { valid: false, canPay: false, shortfall: requestedAmount - balance };
  }

  return { valid: true, canPay: true };
};

/**
 * Arbitrary batch settlement is intentionally unavailable. Each booking must
 * be settled by its own idempotent canonical ride transition.
 */
export const processBatchPayments = async () => {
  throw new Error('LEGACY_BATCH_PAYMENT_FLOW_DISABLED: usa la liquidación canónica del viaje.');
};
