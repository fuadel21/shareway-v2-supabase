import { describe, expect, it } from 'vitest';
import {
    canPresentStartRide,
    getBoardingSummary,
    getStartBlockReason,
    normalizeBoardingPin,
} from './rideBoarding';

const soon = (minutes) => new Date(Date.now() + minutes * 60 * 1000).toISOString();

describe('ride boarding gates', () => {
    it('normalizes PIN input to digits only', () => {
        expect(normalizeBoardingPin(' 12 34 ')).toBe('1234');
        expect(normalizeBoardingPin('ab89cd')).toBe('89');
    });

    it('blocks start while a confirmed passenger still needs a PIN', () => {
        const ride = {
            status: 'scheduled',
            departure_time: soon(5),
            passengers: [{ id: 'p1', status: 'confirmed' }],
        };

        expect(canPresentStartRide({ ride })).toBe(false);
        expect(getStartBlockReason({ ride })).toMatch(/PIN/i);
    });

    it('blocks start when a passenger or request is unpaid', () => {
        const ride = {
            status: 'scheduled',
            departure_time: soon(5),
            passengers: [{ id: 'p1', status: 'pending' }],
            ride_requests: [{ id: 'r1', status: 'pending' }],
        };

        const summary = getBoardingSummary(ride);
        expect(summary.ready).toBe(false);
        expect(summary.unpaidCount).toBeGreaterThan(0);
        expect(getStartBlockReason({ ride })).toMatch(/sin pagar/i);
    });

    it('allows start only after paid passengers are verified or resolved', () => {
        const ride = {
            status: 'scheduled',
            departure_time: soon(5),
            passengers: [
                { id: 'p1', status: 'verified' },
                { id: 'p2', status: 'no_show' },
            ],
        };

        expect(canPresentStartRide({ ride })).toBe(true);
        expect(getStartBlockReason({ ride })).toBeNull();
    });

    it('fails closed when readiness cannot be checked', () => {
        const ride = {
            status: 'scheduled',
            departure_time: soon(5),
            passengers: [{ id: 'p1', status: 'verified' }],
        };

        expect(canPresentStartRide({
            ride,
            readiness: { ready: false, unavailable: true, error: 'network' },
        })).toBe(false);
    });
});
