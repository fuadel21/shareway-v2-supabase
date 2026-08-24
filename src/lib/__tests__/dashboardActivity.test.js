import { describe, it, expect } from 'vitest';
import {
    buildDriverPendingInbox,
    countPendingOnRide,
    getActivityStatPath,
} from '../dashboardActivity';

describe('dashboardActivity', () => {
    it('counts pending passengers and request collections', () => {
        expect(countPendingOnRide({
            pending_requests_count: 2,
            passengers: [{ status: 'pending' }],
        })).toBe(2);

        expect(countPendingOnRide({
            passengers: [{ status: 'confirmed' }, { status: 'pending' }],
            requests: [{ status: 'requested' }],
        })).toBe(2);
    });

    it('builds a driver inbox only for open rides with pending requests', () => {
        const inbox = buildDriverPendingInbox([
            {
                id: 'ride-1',
                driver_id: 'driver-1',
                role: 'driver',
                status: 'scheduled',
                departure_time: '2026-08-22T08:00:00.000Z',
                passengers: [{ status: 'pending' }, { status: 'confirmed' }],
            },
            {
                id: 'ride-2',
                driver_id: 'driver-1',
                status: 'completed',
                passengers: [{ status: 'pending' }],
            },
            {
                id: 'ride-3',
                driver_id: 'other',
                role: 'passenger',
                status: 'scheduled',
                passengers: [{ status: 'pending' }],
            },
        ], 'driver-1');

        expect(inbox).toHaveLength(1);
        expect(inbox[0]).toMatchObject({ id: 'ride-1', pendingCount: 1 });
    });

    it('routes pending request stats to the upcoming rides tab', () => {
        expect(getActivityStatPath('pendingRequests')).toBe('/my-rides?tab=active');
        expect(getActivityStatPath('openRequests')).toBe('/my-requests');
    });
});
