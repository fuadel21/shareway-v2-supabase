import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

/**
 * Hook personalizado para obtener el estado completo del wallet del usuario con Realtime Robusto.
 * @param {object} user - El objeto de usuario autenticado.
 */
export const useWallet = (user) => {
  const [wallet, setWallet] = useState(null);
  const [loading, setLoading] = useState(true);

  const refreshWallet = useCallback(async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase
        .from('wallets')
        .select('balance, held_balance')
        .eq('user_id', user.id);

      if (error) throw error;

      if (data && data.length > 0) {
        // En un sistema ideal, solo hay 1 monedero por user.
        // Si hay varios, alertamos y sumamos para no perder fondos del usuario.
        if (data.length > 1) console.warn(`🛡️ Integrity Alert: User ${user.id} has multiple wallets.`);

        const totalBalance = data.reduce((acc, curr) => acc + (Number(curr.balance) || 0), 0);
        const totalHeld = data.reduce((acc, curr) => acc + (Number(curr.held_balance) || 0), 0);

        setWallet({
          balance: totalBalance,
          heldBalance: totalHeld,
        });
      }
    } catch (e) {
      console.error("❌ Error refreshing wallet:", e);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      setWallet(null);
      return;
    }

    refreshWallet();

    // Realtime Listener Blindado
    // En lugar de actualizar solo con payload.new, disparamos refreshWallet
    // para asegurar consistencia con todas las posibles filas y transacciones.
    const channel = supabase
      .channel(`wallet_sync_${user.id}`)
      .on('postgres_changes', {
        event: '*', // Escuchamos todo (INSERT, UPDATE, DELETE)
        schema: 'public',
        table: 'wallets',
        filter: `user_id=eq.${user.id}`
      }, () => {
        refreshWallet();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, refreshWallet]);

  return { wallet, loadingWallet: loading, refreshWallet };
};
