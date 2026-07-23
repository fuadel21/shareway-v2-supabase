import { describe, expect, it } from 'vitest';
import {
  getRecoveryDecision,
  isCardRecoveryMarker,
  recoveryMessageForState,
} from './bookingPaymentRecovery.js';

describe('booking payment recovery decisions', () => {
  it('protects ambiguous card confirmation markers', () => {
    expect(isCardRecoveryMarker({ method: 'card', status: 'stripe_confirming' })).toBe(true);
    expect(isCardRecoveryMarker({ method: 'card', status: 'server_confirming' })).toBe(true);
    expect(isCardRecoveryMarker({ method: 'wallet', status: 'server_confirming' })).toBe(false);
  });

  it('clears a marker after the booking is confirmed', () => {
    expect(getRecoveryDecision({ state: 'confirmed', bookingConfirmed: true })).toEqual({
      clearMarker: true,
      replayDismiss: false,
      confirmed: true,
    });
  });

  it('allows a fresh attempt only after a definitive retryable state', () => {
    expect(getRecoveryDecision({ state: 'retryable', canDismiss: true })).toEqual({
      clearMarker: true,
      replayDismiss: true,
      confirmed: false,
    });
  });

  it('keeps paid, processing and unknown states locked', () => {
    for (const state of ['paid_waiting_booking', 'pending', 'unknown']) {
      expect(getRecoveryDecision({ state, canDismiss: false }).clearMarker).toBe(false);
    }
  });

  it('explains why a succeeded payment remains protected', () => {
    expect(recoveryMessageForState({ state: 'paid_waiting_booking' })).toContain('Stripe ya confirmó');
  });
});
