import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Loader2, RefreshCw, X } from 'lucide-react';
import { supabase } from '../lib/supabase.js';

const reasonMessages = {
  DRIVER_CANNOT_BOOK_OWN_RIDE: 'No puedes reservar una plaza en tu propio viaje.',
  RIDE_NOT_SCHEDULED: 'Este viaje ya no está disponible para reservar.',
  RIDE_ALREADY_DEPARTED: 'Este viaje ya ha salido o ha expirado.',
  NO_SEATS_AVAILABLE: 'No quedan plazas disponibles en este viaje.',
  ALREADY_BOOKED: 'Ya tienes una reserva activa en este viaje.',
};

const getRideIdFromPath = () => {
  const match = window.location.pathname.match(/^\/ride\/([^/]+)$/);
  return match?.[1] || null;
};

const isBookingDialogOpen = () => Boolean(
  document.querySelector('[role="dialog"]')?.textContent?.toLowerCase().includes('reserva') ||
  document.querySelector('[role="dialog"]')?.textContent?.toLowerCase().includes('booking')
);

const BookingContractGuard = () => {
  const [rideId, setRideId] = useState(getRideIdFromPath());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const blockedMessage = useMemo(() => {
    if (!state || state.can_book !== false) return null;
    return reasonMessages[state.reason] || 'La reserva ya no está disponible.';
  }, [state]);

  const refresh = useCallback(async () => {
    const currentRideId = getRideIdFromPath();
    setRideId(currentRideId);
    if (!currentRideId || !isBookingDialogOpen()) {
      setState(null);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('get_booking_contract_state', {
        p_ride_id: currentRideId,
      });
      if (rpcError) throw rpcError;
      setState(data);
    } catch (err) {
      console.error('Booking contract preflight failed:', err);
      setState(null);
      setError('No se pudo comprobar la disponibilidad. Cierra la reserva y vuelve a intentarlo.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const syncDialog = () => {
      const open = isBookingDialogOpen();
      setDialogOpen(open);
      if (open) refresh();
      else {
        setState(null);
        setError(null);
      }
    };

    syncDialog();
    const observer = new MutationObserver(syncDialog);
    observer.observe(document.body, { childList: true, subtree: true });

    const onFocus = () => dialogOpen && refresh();
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && dialogOpen) refresh();
    };

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      observer.disconnect();
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [dialogOpen, refresh]);

  useEffect(() => {
    if (!dialogOpen || !rideId) return undefined;

    const channel = supabase
      .channel(`booking_contract_${rideId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'rides',
        filter: `id=eq.${rideId}`,
      }, refresh)
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [dialogOpen, rideId, refresh]);

  if (!dialogOpen || (!loading && !blockedMessage && !error)) return null;

  return (
    <div className="fixed inset-0 z-[250] flex items-center justify-center bg-slate-950/55 p-5 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-[2rem] border border-white/20 bg-white p-6 shadow-2xl">
        {loading && !blockedMessage && !error ? (
          <div className="flex flex-col items-center gap-4 py-4 text-center">
            <Loader2 className="size-9 animate-spin text-slate-900" />
            <div>
              <p className="text-xs font-black uppercase tracking-widest text-slate-900">Comprobando reserva</p>
              <p className="mt-2 text-sm font-semibold text-slate-500">Estamos verificando plazas y estado del viaje.</p>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="flex items-start gap-3">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-red-50 text-red-600">
                <AlertCircle className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-black uppercase tracking-widest text-slate-900">Reserva bloqueada</p>
                <p className="mt-2 text-sm font-semibold leading-relaxed text-slate-600">{error || blockedMessage}</p>
                {state?.seats_available != null && (
                  <p className="mt-2 text-xs font-bold text-slate-400">Plazas disponibles: {state.seats_available}</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={refresh}
                className="flex h-12 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white text-[10px] font-black uppercase tracking-widest text-slate-700"
              >
                <RefreshCw className="size-4" /> Reintentar
              </button>
              <button
                type="button"
                onClick={() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))}
                className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-slate-900 text-[10px] font-black uppercase tracking-widest text-white"
              >
                <X className="size-4" /> Cerrar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default BookingContractGuard;
