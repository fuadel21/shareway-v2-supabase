/**
 * Compatibilidad del antiguo servicio de escrow.
 *
 * Las reservas de ShareWay ya no pasan por un escrow genérico. El bloqueo,
 * reembolso y liquidación se realizan dentro de las transiciones financieras
 * canónicas (quote/prepare/fulfill/cancel/dropoff) y quedan en
 * ride_financial_ledger. Mantener llamadas a move_to_escrow o
 * release_from_escrow permitiría saltarse Stripe y la política multi-plaza.
 */
import { supabase } from '@/lib/supabase';

const LEGACY_ESCROW_ERROR =
  'El escrow genérico está deshabilitado. Usa el flujo de reserva y liquidación canónico.';

const rejectLegacyEscrowOperation = async () => {
  throw new Error(LEGACY_ESCROW_ERROR);
};

/** @deprecated Las reservas se preparan y liquidan mediante el flujo canónico. */
export const moveToEscrow = rejectLegacyEscrowOperation;

/** @deprecated Los reembolsos se ejecutan mediante las Edge Functions canónicas. */
export const releaseFromEscrow = rejectLegacyEscrowOperation;

/**
 * El saldo retenido sigue siendo visible porque forma parte del modelo de
 * wallet canónico; no se consulta la tabla histórica escrow_transactions.
 */
export const getEscrowBalance = async (userId) => {
  if (!userId) throw new Error('USER_REQUIRED');

  const { data, error } = await supabase
    .from('wallets')
    .select('held_balance')
    .eq('user_id', userId)
    .single();

  if (error) throw error;
  return Number(data?.held_balance || 0);
};

/** @deprecated Las liberaciones automáticas genéricas ya no están permitidas. */
export const processEscrowReleases = rejectLegacyEscrowOperation;

/** @deprecated Las disputas no pueden mover fondos fuera de las transiciones canónicas. */
export const resolveDispute = rejectLegacyEscrowOperation;

/**
 * Alias de lectura conservado para consumidores antiguos, ahora sobre el
 * ledger auditable. No expone ni muta la tabla histórica de escrow.
 */
export const getEscrowTransactions = async (userId, filters = {}) => {
  if (!userId) throw new Error('USER_REQUIRED');

  let query = supabase
    .from('ride_financial_ledger')
    .select('*')
    .eq('actor_user_id', userId);

  const { startDate, endDate } = filters;
  if (startDate) query = query.gte('created_at', startDate.toISOString ? startDate.toISOString() : startDate);
  if (endDate) query = query.lte('created_at', endDate.toISOString ? endDate.toISOString() : endDate);

  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
};

/** @deprecated Los bloqueos genéricos están deshabilitados. */
export const holdEscrowFunds = rejectLegacyEscrowOperation;

/** @deprecated No existe una liberación genérica que pueda validarse de forma segura. */
export const validateEscrowRelease = rejectLegacyEscrowOperation;

/** @deprecated Las métricas de escrow histórico no representan el ledger actual. */
export const getEscrowStatistics = rejectLegacyEscrowOperation;

export default {};
