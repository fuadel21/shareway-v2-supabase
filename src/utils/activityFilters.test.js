import { describe, expect, it } from 'vitest';
import {
  filterActivityByTab,
  getEffectiveActivityStatus,
  getEffectiveRequestStatus,
  normalizeActivityStatus,
} from './activityFilters.js';

const now = new Date('2026-08-31T12:00:00.000Z');
const hoursFromNow = (hours) => new Date(now.getTime() + hours * 60 * 60 * 1000).toISOString();

const activity = (id, overrides = {}) => ({
  id,
  role: 'driver',
  status: 'scheduled',
  departure_time: hoursFromNow(4),
  ...overrides,
});

describe('activity filters', () => {
  it('normalizes legacy terminal status spellings', () => {
    expect(normalizeActivityStatus('canceled')).toBe('cancelled');
    expect(normalizeActivityStatus('finished')).toBe('completed');
    expect(normalizeActivityStatus('fulfilled')).toBe('completed');
    expect(normalizeActivityStatus('declined')).toBe('rejected');
  });

  it('expires stale open activities but never overwrites an explicit terminal state', () => {
    expect(getEffectiveActivityStatus(activity('old'), {
      now,
      graceMinutes: 120,
    })).toBe('scheduled');

    expect(getEffectiveActivityStatus(activity('stale', {
      departure_time: hoursFromNow(-3),
    }), {
      now,
      graceMinutes: 120,
    })).toBe('expired');

    expect(getEffectiveActivityStatus(activity('cancelled', {
      status: 'cancelled',
      departure_time: hoursFromNow(-12),
    }), {
      now,
      graceMinutes: 120,
    })).toBe('cancelled');
  });

  it('moves stale requester activity and parent terminal states out of requests', () => {
    expect(getEffectiveActivityStatus(activity('request', {
      role: 'requester',
      request_id: 'request-1',
      status: 'requested',
      departure_time: hoursFromNow(-3),
    }), { now })).toBe('expired');

    expect(getEffectiveActivityStatus(activity('pending-request', {
      role: 'requester',
      request_id: 'request-pending',
      status: 'pending',
      departure_time: hoursFromNow(-3),
    }), { now })).toBe('expired');

    expect(getEffectiveActivityStatus(activity('parent-cancelled', {
      role: 'requester',
      request_id: 'request-2',
      status: 'requested',
      real_ride_status: 'canceled',
      departure_time: hoursFromNow(4),
    }), { now })).toBe('cancelled');
  });

  it('keeps history backward-compatible while exposing narrow cancelled and expired filters', () => {
    const rows = [
      activity('future'),
      activity('completed', { status: 'completed', departure_time: hoursFromNow(-6) }),
      activity('cancelled', { status: 'canceled', departure_time: hoursFromNow(-4) }),
      activity('expired', { departure_time: hoursFromNow(-3) }),
      activity('request', {
        role: 'requester',
        request_id: 'request-1',
        status: 'requested',
        departure_time: hoursFromNow(2),
      }),
    ];

    expect(filterActivityByTab(rows, 'active', { now }).map((row) => row.id)).toEqual(['future']);
    expect(filterActivityByTab(rows, 'requested', { now }).map((row) => row.id)).toEqual(['request']);
    expect(filterActivityByTab(rows, 'cancelled', { now }).map((row) => row.id)).toEqual(['cancelled']);
    expect(filterActivityByTab(rows, 'expired', { now }).map((row) => row.id)).toEqual(['expired']);
    expect(filterActivityByTab(rows, 'history', { now }).map((row) => row.id)).toEqual([
      'completed',
      'cancelled',
      'expired',
    ]);
  });

  it('maps fulfilled requests to completed and expires old open requests', () => {
    expect(getEffectiveRequestStatus({ status: 'fulfilled', departure_time: hoursFromNow(-24) }, { now }))
      .toBe('completed');
    expect(getEffectiveRequestStatus({ status: 'pending', departure_time: hoursFromNow(-3) }, { now }))
      .toBe('expired');
    expect(getEffectiveRequestStatus({ status: 'cancelled', departure_time: hoursFromNow(4) }, { now }))
      .toBe('cancelled');
    expect(getEffectiveRequestStatus({
      status: 'pending',
      departure_time: hoursFromNow(8),
      expires_at: hoursFromNow(-1),
    }, { now })).toBe('expired');
  });
});
