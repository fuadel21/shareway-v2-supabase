import { describe, expect, it } from 'vitest';

import { filterBookableRides, isRideBookable } from './rideService.js';

const NOW = new Date('2026-07-21T10:00:00.000Z');
const futureDeparture = '2026-07-21T12:00:00.000Z';
const pastDeparture = '2026-07-21T09:59:00.000Z';

const makeRide = (overrides = {}) => ({
  id: 'ride-1',
  status: 'scheduled',
  departure_time: futureDeparture,
  seats_available: 3,
  ...overrides,
});

describe('isRideBookable', () => {
  it('allows a scheduled future ride with available seats', () => {
    expect(isRideBookable(makeRide(), NOW)).toBe(true);
  });

  it.each([
    'active',
    'in_progress',
    'completed',
    'cancelled',
    'expired',
  ])('blocks a ride with status %s', (status) => {
    expect(isRideBookable(makeRide({ status }), NOW)).toBe(false);
  });

  it('blocks a ride whose departure time has already passed', () => {
    expect(isRideBookable(makeRide({ departure_time: pastDeparture }), NOW)).toBe(false);
  });

  it('blocks a ride with zero available seats', () => {
    expect(isRideBookable(makeRide({ seats_available: 0 }), NOW)).toBe(false);
  });

  it('blocks a ride with a negative seat count', () => {
    expect(isRideBookable(makeRide({ seats_available: -1 }), NOW)).toBe(false);
  });

  it('supports the legacy available_seats field', () => {
    const ride = makeRide({ seats_available: undefined, available_seats: 2 });
    expect(isRideBookable(ride, NOW)).toBe(true);
  });

  it('blocks malformed or missing departure dates', () => {
    expect(isRideBookable(makeRide({ departure_time: 'invalid-date' }), NOW)).toBe(false);
    expect(isRideBookable(makeRide({ departure_time: null }), NOW)).toBe(false);
  });

  it('blocks null and undefined rides', () => {
    expect(isRideBookable(null, NOW)).toBe(false);
    expect(isRideBookable(undefined, NOW)).toBe(false);
  });
});

describe('filterBookableRides', () => {
  it('keeps only scheduled future rides with free seats', () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const rides = [
      makeRide({ id: 'available', departure_time: future }),
      makeRide({ id: 'full', departure_time: future, seats_available: 0 }),
      makeRide({ id: 'cancelled', departure_time: future, status: 'cancelled' }),
      makeRide({ id: 'past', departure_time: past }),
    ];

    expect(filterBookableRides(rides).map((ride) => ride.id)).toEqual(['available']);
  });

  it('returns an empty array for missing input', () => {
    expect(filterBookableRides()).toEqual([]);
    expect(filterBookableRides(null)).toEqual([]);
  });
});
