import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { supabase } from '../lib/supabase.js';
import {
  getRecoveryDecision,
  isCardRecoveryMarker,
  recoveryMessageForState,
} from '../lib/bookingPaymentRecovery.js';

const PENDING_PREFIX = 'sw_pending_booking_recovery:';
const PENDING_TTL_MS = 30 * 60 * 1000;

const getRideIdFromPath = () => {
  const match = window.location.pathname.match(/^\/ride\/([^/]+)$/);
  return match?.[1] || null;
};

const pendingKey = (rideId) => `${PENDING_PREFIX}${rideId}`;

const readPendingBooking = (rideId) => {
  if (!rideId) return null;

  try {
    const raw = localStorage.getItem(pendingKey(rideId));
    if (!raw) return null;

    const pending = JSON.parse(raw);
    if (!pending?.savedAt || Date.now() - pending.savedAt > PENDING_TTL_MS) {
      localStorage.removeItem(pendingKey(rideId));
      return null;
    }

    return pending;
  } catch {
    localStorage.removeItem(pendingKey(rideId));
    return null;
  }
};

const isRecoveryDismissButton = (target) => {
  if (!(target instanceof Element)) return null;

  const button = target.closest('button');
  if (!button) return null;

  const dialog = button.closest('[role="dialog"]');
  const recoveryPanel = button.closest('.bg-amber-50');
  const className = String(button.className || '');

  return dialog &&
    recoveryPanel &&
    className.includes('underline') &&
    className.includes('text-amber-700/60')
    ? button
    : null;
};

const BookingPendingPaymentDismissGuard = () => {
  const replayingRef = useRef(false);
  const checkingRef = useRef(false);

  useEffect(() => {
    const verifyAndResolve = async ({ rideId, pending, button = null }) => {
      if (checkingRef.current) return;
      checkingRef.current = true;

      const toastId = toast.loading('Comprobando el primer pago…');

      try {
        const { data, error } = await supabase.functions.invoke(
          'get-booking-payment-recovery-state',
          {
            body: {
              rideId,
              paymentIntentId: pending?.paymentIntentId || null,
            },
          },
        );

        if (error) throw error;
        if (data?.error?.message) throw new Error(data.error.message);

        const decision = getRecoveryDecision(data);

        if (!decision.clearMarker) {
          toast.info('Pago todavía protegido', {
            id: toastId,
            description: recoveryMessageForState(data),
            duration: 7000,
          });
          return;
        }

        localStorage.removeItem(pendingKey(rideId));
        window.dispatchEvent(new CustomEvent('shareway:booking-recovery-resolved', {
          detail: { rideId, state: data?.state, confirmed: decision.confirmed },
        }));

        if (decision.confirmed) {
          toast.success('Reserva confirmada', {
            id: toastId,
            description: 'La plaza ya aparece asignada. No se realizará otro cobro.',
            duration: 6000,
          });
          return;
        }

        toast.success('Pago anterior resuelto', {
          id: toastId,
          description: 'El intento anterior no terminó en cobro. Ya puedes volver a intentarlo.',
          duration: 5000,
        });

        if (decision.replayDismiss && button?.isConnected) {
          replayingRef.current = true;
          button.click();
          queueMicrotask(() => {
            replayingRef.current = false;
          });
        }
      } catch (error) {
        console.error('Booking payment recovery verification failed:', error);
        toast.error('No se pudo verificar el pago', {
          id: toastId,
          description: 'El aviso se mantiene para evitar un posible segundo cobro.',
          duration: 7000,
        });
      } finally {
        checkingRef.current = false;
      }
    };

    const blockUnsafeDismiss = (event) => {
      if (replayingRef.current) return;

      const button = isRecoveryDismissButton(event.target);
      if (!button) return;

      const rideId = getRideIdFromPath();
      const pending = readPendingBooking(rideId);
      if (!isCardRecoveryMarker(pending) && !pending?.paymentIntentId) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      verifyAndResolve({ rideId, pending, button });
    };

    const recoverOnReturn = () => {
      if (document.visibilityState !== 'visible') return;
      const rideId = getRideIdFromPath();
      const pending = readPendingBooking(rideId);
      if (!isCardRecoveryMarker(pending) && !pending?.paymentIntentId) return;
      verifyAndResolve({ rideId, pending });
    };

    document.addEventListener('click', blockUnsafeDismiss, true);
    document.addEventListener('visibilitychange', recoverOnReturn);
    window.addEventListener('online', recoverOnReturn);

    return () => {
      document.removeEventListener('click', blockUnsafeDismiss, true);
      document.removeEventListener('visibilitychange', recoverOnReturn);
      window.removeEventListener('online', recoverOnReturn);
    };
  }, []);

  return null;
};

export default BookingPendingPaymentDismissGuard;
