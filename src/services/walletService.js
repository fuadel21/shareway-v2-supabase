/**
 * Servicio de Wallet - Migrado a Supabase
 */
import { supabase } from '../lib/supabase';
import { addFunds, requestPayout as requestPayoutRPC } from '@/lib/supabaseRPC.js';
import { toast } from 'sonner';

/**
 * Error personalizado para manejar errores de la aplicación
 */
class AppError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = 'AppError';
  }
}

/**
 * Llama a la función RPC 'add_funds' para procesar una recarga.
 */
export const addFundsToWallet = async (amount, paymentMethodId) => {
  try {
    if (!amount || amount <= 0 || !paymentMethodId) {
      throw new AppError('validation/missing-params', "Se requiere una cantidad y un método de pago.");
    }

    // Llamada a la función RPC wrapper
    const result = await addFunds(amount, paymentMethodId);

    if (result && result.success) {
      return result;
    }

    return { success: false, message: 'La respuesta del servidor fue inesperada o nula.' };

  } catch (error) {
    console.error("Error al llamar a addFundsRPC:", error);
    // Simple manejo de error, puedes expandirlo si necesitas compatibilidad exacta con handleFirebaseError
    throw new AppError(error.code || 'unknown', error.message || "Error al procesar la recarga");
  }
};

/**
 * Llama a la función RPC 'request_payout' para iniciar un retiro de saldo.
 */
export const requestPayout = async (amount) => {
  try {
    const result = await requestPayoutRPC(amount);

    if (result && result.success) {
      return result;
    }
    return { success: false, message: 'La respuesta del servidor fue inesperada.' };
  } catch (error) {
    console.error("Error al llamar a requestPayoutRPC:", error);
    throw new AppError(error.code || 'unknown', error.message || "Error al solicitar el pago");
  }
};

/**
 * Obtiene el historial de transacciones de un usuario en tiempo real.
 * Migrado de Firestore (subcolección) a Supabase Realtime (tabla 'transactions' filtrada por user_id)
 */
export const onTransactionsUpdate = (userId, onUpdate) => {
  if (!userId) {
    onUpdate([]);
    return () => { };
  }

  // 1. Obtener datos iniciales
  const fetchTransactions = async () => {
    try {
      const { data, error } = await supabase
        .from('transactions')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      onUpdate(data || []);
    } catch (error) {
      console.error("Error al obtener las transacciones:", error);
      toast.error("No se pudo cargar el historial de transacciones.");
      onUpdate([]);
    }
  };

  fetchTransactions();

  // 2. Suscribirse a cambios
  const channel = supabase
    .channel(`transactions_${userId}`)
    .on('postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'transactions',
        filter: `user_id=eq.${userId}`
      },
      (payload) => {
        // Cuando llega una nueva transacción, la agregamos al principio de la lista
        // Nota: Para una UI completa, lo ideal es refrescar la lista o manejar el estado local
        // Aquí simplemente volvemos a pedir los datos para asegurar el orden correcto y consistencia
        fetchTransactions();
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
};
