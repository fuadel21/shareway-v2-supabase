import { describe, expect, it } from 'vitest';
import {
  getRideReviewParticipantIds,
  validatePostRideReviewAccess,
} from './postRideReviewAccess.js';

const completedRide = {
  id: 'ride-1',
  status: 'completed',
  driver_id: 'driver-1',
  participant_ids: ['passenger-1'],
  passengers: [
    { user_id: 'passenger-1', status: 'verified' },
    { user_id: 'cancelled-user', status: 'cancelled' },
  ],
};

describe('post-ride review access', () => {
  it('collects the driver and eligible passengers only', () => {
    expect([...getRideReviewParticipantIds(completedRide)].sort()).toEqual([
      'driver-1',
      'passenger-1',
    ]);
  });

  it('allows a passenger to review the driver after completion', () => {
    expect(validatePostRideReviewAccess({
      ride: completedRide,
      reviewerId: 'passenger-1',
      revieweeId: 'driver-1',
    }).allowed).toBe(true);
  });

  it('allows the driver to review a completed passenger', () => {
    expect(validatePostRideReviewAccess({
      ride: completedRide,
      reviewerId: 'driver-1',
      revieweeId: 'passenger-1',
    }).allowed).toBe(true);
  });

  it('blocks reviews before the ride is completed', () => {
    const result = validatePostRideReviewAccess({
      ride: { ...completedRide, status: 'active' },
      reviewerId: 'passenger-1',
      revieweeId: 'driver-1',
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('completar');
  });

  it('blocks outsiders, cancelled passengers and self reviews', () => {
    expect(validatePostRideReviewAccess({
      ride: completedRide,
      reviewerId: 'outsider',
      revieweeId: 'driver-1',
    }).allowed).toBe(false);

    expect(validatePostRideReviewAccess({
      ride: completedRide,
      reviewerId: 'driver-1',
      revieweeId: 'cancelled-user',
    }).allowed).toBe(false);

    expect(validatePostRideReviewAccess({
      ride: completedRide,
      reviewerId: 'driver-1',
      revieweeId: 'driver-1',
    }).allowed).toBe(false);
  });
});
