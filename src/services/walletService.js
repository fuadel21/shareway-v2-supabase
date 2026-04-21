/**
 * Servicio de Wallet Elite v3.0 - Blindaje Financiero y Liquidación Atómica
 */
import { supabase } from '../lib/supabase';
import { addFunds, requestPayout as requestPayoutRPC } from '@/lib/supabaseRPC.js';

// Semáforo de transacciones activas para evitar Double-Spending técnico
let activeTransactions = new Set();

/**
 * Obtiene el saldo actual y estado de la wallet del usuario.
 */
export const getWalletData = async (userId) => {
    try {
        const { data, error } = await supabase
            .from('wallets')
            .select('balance, held_balance, currency')
            .eq('user_id', userId)
            .single();

        if (error) throw error;
        return data;
    } catch (error) {
        console.error("🛡️ [Wallet] Error fetching wallet data:", error);
        return { balance: 0, held_balance: 0, currency: 'EUR' };
    }
};

/**
 * Procesa una recarga de saldo mediante el RPC seguro.
 */
export const addFundsToWallet = async (amount, paymentMethodId) => {
    const txKey = `deposit_${amount}_${paymentMethodId}`;
    if (activeTransactions.has(txKey)) throw new Error("Recarga en curso. Por favor, espera.");

    try {
        activeTransactions.add(txKey);
        const { data, success, error } = await addFunds(amount, paymentMethodId);

        if (!success) {
            if (error?.includes('LIMIT_EXCEEDED')) throw new Error("La recarga supera el límite permitido.");
            throw new Error(error || 'La recarga no pudo procesarse.');
        }

        return data;
    } catch (error) {
        console.error("🛡️ [Wallet] Deposit failed:", error);
        throw error;
    } finally {
        setTimeout(() => activeTransactions.delete(txKey), 3000);
    }
};

/**
 * Solicita el retiro de fondos (Payout) al conductor.
 */
export const requestPayout = async (amount) => {
    if (amount < 5) throw new Error("El monto mínimo de retiro es de 5€.");
    
    const txKey = `payout_${amount}`;
    if (activeTransactions.has(txKey)) throw new Error("Ya hay un retiro procesándose.");

    try {
        activeTransactions.add(txKey);
        const { data, success, error } = await requestPayoutRPC(amount);

        if (!success) {
            if (error?.includes('INSUFFICIENT_FUNDS')) throw new Error("No tienes saldo suficiente para este retiro.");
            throw new Error(error || 'Error al procesar el retiro.');
        }

        return data;
    } catch (error) {
        console.error("🛡️ [Wallet] Payout failed:", error);
        throw error;
    } finally {
        setTimeout(() => activeTransactions.delete(txKey), 3000);
    }
};

/**
 * Historial de transacciones optimizado con Realtime.
 */
export const subscribeToTransactions = (userId, onUpdate) => {
    if (!userId) return () => {};

    const fetchHistory = async () => {
        const { data, error } = await supabase
            .from('transactions')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(50);
        
        if (!error) onUpdate(data || []);
    };

    fetchHistory();

    const channel = supabase
        .channel(`wallet_activity_${userId}`)
        .on('postgres_changes', 
            { event: 'INSERT', schema: 'public', table: 'transactions', filter: `user_id=eq.${userId}` }, 
            () => fetchHistory()
        )
        .subscribe();

    return () => supabase.removeChannel(channel);
};

/**
 * Lógica de Liquidación: Confirma la llegada y libera fondos.
 * Este método es el puente final entre el viaje y el dinero.
 */
export const settleRideFunds = async (rideId) => {
    try {
        const { data, success, error } = await supabase.rpc('confirm_passenger_arrival', { p_ride_id: rideId });
        if (!success) throw new Error(error);

        // Blindaje: Verificar éxito lógico del negocio
        if (data && data.success === false) {
            throw new Error(data.message || 'No se pudo liquidar el viaje');
        }

        return data;
    } catch (error) {
        console.error("🛡️ [Wallet] Settlement failed:", error);
        throw error;
    }
};
