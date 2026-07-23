import { useEffect } from 'react';
import { toast } from 'sonner';

const PENDING_PREFIX = 'sw_pending_booking_recovery:';
const PENDING_TTL_MS = 30 * 60 * 1000;

const getRideIdFromPath = () => {
  const match = window.location.pathname.match(/^\/ride\/([^/]+)$/);
  return match?.[1] || null;
};

const readPendingBooking = (rideId) => {
  if (!rideId) return null;

  try {
    const raw = localStorage.getItem(`${PENDING_PREFIX}${rideId}`);
    if (!raw) return null;

    const pending = JSON.parse(raw);
    if (!pending?.savedAt || Date.now() - pending.savedAt > PENDING_TTL_MS) {
      return null;
    }

    return pending;
  } catch {
    return null;
  }
};

const isRecoveryDismissButton = (target) => {
  if (!(target instanceof Element)) return false;

  const button = target.closest('button');
  if (!button) return false;

  const dialog = button.closest('[role="dialog"]');
  const recoveryPanel = button.closest('.bg-amber-50');
  const className = String(button.className || '');

  return Boolean(
    dialog &&
    recoveryPanel &&
    className.includes('underline') &&
    className.includes('text-amber-700/60')
  );
};

// Only retain the hard lock when the client has evidence that Stripe accepted
// the payment. Pre-call status markers are not enough: they can survive a
// definitive validation, network or wallet failure before any charge occurred.
const isUnresolvedAcceptedPayment = (pending) => Boolean(
  pending?.method === 'card' &&
  typeof pending?.paymentIntentId === 'string' &&
  pending.paymentIntentId.trim().length > 0
);

const BookingPendingPaymentDismissGuard = () => {
  useEffect(() => {
    const blockUnsafeDismiss = (event) => {
      if (!isRecoveryDismissButton(event.target)) return;

      const rideId = getRideIdFromPath();
      const pending = readPendingBooking(rideId);
      if (!isUnresolvedAcceptedPayment(pending)) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      toast.info('Pago todavía en comprobación', {
        description: 'Stripe ya aceptó este pago y estamos esperando la confirmación de la plaza. Usa “Comprobar otra vez” o abre el viaje para evitar un segundo cobro.',
        duration: 6000,
      });
    };

    document.addEventListener('click', blockUnsafeDismiss, true);
    return () => document.removeEventListener('click', blockUnsafeDismiss, true);
  }, []);

  return null;
};

export default BookingPendingPaymentDismissGuard;
