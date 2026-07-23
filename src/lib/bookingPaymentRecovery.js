export const isCardRecoveryMarker = (pending) => Boolean(
  pending?.method === 'card' &&
  ['stripe_confirming', 'server_confirming'].includes(String(pending?.status || ''))
);

export const getRecoveryDecision = (result) => {
  if (result?.bookingConfirmed || result?.state === 'confirmed') {
    return { clearMarker: true, replayDismiss: false, confirmed: true };
  }

  if (result?.canDismiss === true || result?.state === 'retryable') {
    return { clearMarker: true, replayDismiss: true, confirmed: false };
  }

  return { clearMarker: false, replayDismiss: false, confirmed: false };
};

export const recoveryMessageForState = (result) => {
  if (result?.state === 'paid_waiting_booking') {
    return 'Stripe ya confirmó el pago. Estamos esperando que el servidor termine de asignar la plaza.';
  }
  if (result?.state === 'pending') {
    return 'El pago sigue procesándose. No inicies otro cobro hasta que finalice.';
  }
  if (result?.state === 'unknown') {
    return 'No hemos podido confirmar todavía el estado final del pago. El aviso se mantiene por seguridad.';
  }
  return 'Estamos comprobando el estado real del primer pago antes de permitir otro intento.';
};
