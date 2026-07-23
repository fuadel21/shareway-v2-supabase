import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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

const pendingKeyForRide = (rideId) => `sw_pending_booking_recovery:${rideId}`;

const hasPendingBooking = (rideId) => {
  if (!rideId) return false;
  try {
    const raw = localStorage.getItem(pendingKeyForRide(rideId));
    if (!raw) return false;
    const pending = JSON.parse(raw);
    return Boolean(pending?.savedAt && Date.now() - pending.savedAt <= 30 * 60 * 1000);
  } catch {
    return false;
  }
};

const findBookingDialog = () => {
  if (!getRideIdFromPath()) return null;
  return Array.from(document.querySelectorAll('[role="dialog"]')).find((dialog) =>
    dialog.classList.contains('sm:max-w-[460px]') ||
    dialog.className.includes('sm:max-w-[460px]')
  ) || null;
};

const isRecoveryDismissButton = (target, dialogElement) => {
  if (!(target instanceof Element) || !dialogElement) return null;
  const button = target.closest('button');
  if (!button || !dialogElement.contains(button)) return null;

  const recoveryPanel = button.closest('.bg-amber-50');
  const className = String(button.className || '');
  if (!recoveryPanel || !className.includes('underline') || !className.includes('text-amber-700/60')) {
    return null;
  }

  return button;
};

const BookingContractGuard = () => {
  const [rideId, setRideId] = useState(getRideIdFromPath());
  const [dialogElement, setDialogElement] = useState(null);
  const [portalElement, setPortalElement] = useState(null);
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [pendingBookingActive, setPendingBookingActive] = useState(() => hasPendingBooking(getRideIdFromPath()));
  const dialogRef = useRef(null);
  const observerTimerRef = useRef(null);
  const requestIdRef = useRef(0);
  const replayDismissRef = useRef(false);

  const blockedMessage = useMemo(() => {
    if (!state || state.can_book !== false) return null;
    if (state.reason === 'ALREADY_BOOKED' && pendingBookingActive) return null;
    return reasonMessages[state.reason] || 'La reserva ya no está disponible.';
  }, [state, pendingBookingActive]);

  const refresh = useCallback(async () => {
    const currentRideId = getRideIdFromPath();
    const currentDialog = findBookingDialog();
    setRideId(currentRideId);
    setPendingBookingActive(hasPendingBooking(currentRideId));

    if (!currentRideId || !currentDialog) {
      setState(null);
      setError(null);
      return;
    }

    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);

    try {
      const { data, error: rpcError } = await supabase.rpc('get_booking_contract_state', {
        p_ride_id: currentRideId,
      });
      if (rpcError) throw rpcError;
      if (requestId === requestIdRef.current) setState(data);
    } catch (err) {
      console.error('Booking contract preflight failed:', err);
      if (requestId === requestIdRef.current) {
        setState(null);
        setError('No se pudo comprobar la disponibilidad. Cierra la reserva y vuelve a intentarlo.');
      }
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const syncDialog = () => {
      if (observerTimerRef.current) window.clearTimeout(observerTimerRef.current);
      observerTimerRef.current = window.setTimeout(() => {
        const nextDialog = findBookingDialog();
        const changed = nextDialog !== dialogRef.current;
        dialogRef.current = nextDialog;
        setDialogElement(nextDialog);

        if (changed && nextDialog) refresh();
        if (changed && !nextDialog) {
          requestIdRef.current += 1;
          setState(null);
          setError(null);
          setLoading(false);
          setPendingBookingActive(false);
        }
      }, 120);
    };

    syncDialog();
    const observer = new MutationObserver(syncDialog);
    observer.observe(document.body, { childList: true, subtree: true });

    const onFocus = () => {
      if (dialogRef.current) refresh();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && dialogRef.current) refresh();
    };

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      observer.disconnect();
      if (observerTimerRef.current) window.clearTimeout(observerTimerRef.current);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refresh]);

  useEffect(() => {
    if (!dialogElement || !rideId) return undefined;

    const onDismissCapture = async (event) => {
      if (replayDismissRef.current) return;

      const button = isRecoveryDismissButton(event.target, dialogElement);
      if (!button || !hasPendingBooking(rideId)) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      const requestId = ++requestIdRef.current;
      setPendingBookingActive(false);
      setLoading(true);
      setError(null);

      try {
        const { data, error: rpcError } = await supabase.rpc('get_booking_contract_state', {
          p_ride_id: rideId,
        });
        if (rpcError) throw rpcError;
        if (requestId !== requestIdRef.current) return;

        localStorage.removeItem(pendingKeyForRide(rideId));
        setPendingBookingActive(false);
        setState(data);
        setLoading(false);

        if (data?.can_book === false) return;
        if (!button.isConnected) return;

        replayDismissRef.current = true;
        button.click();
        queueMicrotask(() => {
          replayDismissRef.current = false;
        });
      } catch (err) {
        console.error('Booking recovery dismissal preflight failed:', err);
        if (requestId === requestIdRef.current) {
          setState(null);
          setLoading(false);
          setError('No se pudo comprobar la reserva. El aviso se mantiene para evitar otro pago.');
        }
      }
    };

    dialogElement.addEventListener('click', onDismissCapture, true);
    return () => dialogElement.removeEventListener('click', onDismissCapture, true);
  }, [dialogElement, rideId]);

  useEffect(() => {
    if (!dialogElement || !rideId) return undefined;

    let previousPending = hasPendingBooking(rideId);
    setPendingBookingActive(previousPending);

    const timer = window.setInterval(() => {
      const nextPending = hasPendingBooking(rideId);
      if (nextPending === previousPending) return;
      previousPending = nextPending;
      setPendingBookingActive(nextPending);
      if (!nextPending) refresh();
    }, 300);

    return () => window.clearInterval(timer);
  }, [dialogElement, rideId, refresh]);

  useEffect(() => {
    if (!dialogElement) {
      setPortalElement(null);
      return undefined;
    }

    const node = document.createElement('div');
    node.dataset.bookingContractPortal = 'true';
    dialogElement.appendChild(node);
    setPortalElement(node);

    return () => {
      node.remove();
      setPortalElement(null);
    };
  }, [dialogElement]);

  const guardActive = Boolean(dialogElement && (loading || blockedMessage || error));

  useEffect(() => {
    if (!dialogElement) return undefined;

    const contentChildren = Array.from(dialogElement.children).filter(
      (child) => child !== portalElement
    );

    if (guardActive) {
      dialogElement.setAttribute('aria-busy', 'true');
      contentChildren.forEach((child) => {
        child.setAttribute('inert', '');
        child.setAttribute('aria-hidden', 'true');
      });
    }

    return () => {
      dialogElement.removeAttribute('aria-busy');
      contentChildren.forEach((child) => {
        child.removeAttribute('inert');
        child.removeAttribute('aria-hidden');
      });
    };
  }, [dialogElement, portalElement, guardActive]);

  useEffect(() => {
    if (!dialogElement || !rideId) return undefined;

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
  }, [dialogElement, rideId, refresh]);

  if (!portalElement || !guardActive) return null;

  return createPortal(
    <div className="absolute inset-0 z-[250] flex items-center justify-center bg-slate-950/55 p-5 backdrop-blur-sm">
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
    </div>,
    portalElement
  );
};

export default BookingContractGuard;
