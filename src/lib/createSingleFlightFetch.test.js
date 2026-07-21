import { describe, expect, it, vi } from 'vitest';

import { createSingleFlightFetch } from './createSingleFlightFetch.js';

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const jsonResponse = (payload = {}) => new Response(JSON.stringify(payload), { status: 200 });

describe('createSingleFlightFetch', () => {
  it('collapses two identical critical RPC calls into one network request', async () => {
    const pending = deferred();
    const baseFetch = vi.fn(() => pending.promise);
    const protectedFetch = createSingleFlightFetch(baseFetch);
    const url = 'https://example.supabase.co/rest/v1/rpc/start_ride';
    const init = { method: 'POST', body: JSON.stringify({ p_ride_id: 'ride-1' }) };

    const first = protectedFetch(url, init);
    const second = protectedFetch(url, init);

    await Promise.resolve();
    expect(baseFetch).toHaveBeenCalledTimes(1);

    pending.resolve(jsonResponse({ success: true }));
    const [firstResponse, secondResponse] = await Promise.all([first, second]);

    expect(firstResponse).not.toBe(secondResponse);
    await expect(firstResponse.json()).resolves.toEqual({ success: true });
    await expect(secondResponse.json()).resolves.toEqual({ success: true });
  });

  it('protects the live SOS v2 RPC from duplicate submissions', async () => {
    const pending = deferred();
    const baseFetch = vi.fn(() => pending.promise);
    const protectedFetch = createSingleFlightFetch(baseFetch);
    const url = 'https://example.supabase.co/rest/v1/rpc/trigger_emergency_alert_v2';
    const init = { method: 'POST', body: JSON.stringify({ p_ride_id: 'ride-1' }) };

    const first = protectedFetch(url, init);
    const second = protectedFetch(url, init);
    await Promise.resolve();

    expect(baseFetch).toHaveBeenCalledTimes(1);
    pending.resolve(jsonResponse({ success: true }));
    await Promise.all([first, second]);
  });

  it('does not collapse identical mutations from different sessions', async () => {
    const pending = deferred();
    const baseFetch = vi.fn(() => pending.promise);
    const protectedFetch = createSingleFlightFetch(baseFetch);
    const url = 'https://example.supabase.co/rest/v1/rpc/cancel_ride';
    const body = JSON.stringify({ p_ride_id: 'ride-1' });

    const first = protectedFetch(url, { method: 'POST', body, headers: { Authorization: 'Bearer user-a' } });
    const second = protectedFetch(url, { method: 'POST', body, headers: { Authorization: 'Bearer user-b' } });
    await Promise.resolve();

    expect(baseFetch).toHaveBeenCalledTimes(2);
    pending.resolve(jsonResponse({ success: true }));
    await Promise.all([first, second]);
  });

  it('does not collapse different rides', async () => {
    const baseFetch = vi.fn(async () => jsonResponse());
    const protectedFetch = createSingleFlightFetch(baseFetch);
    const url = 'https://example.supabase.co/rest/v1/rpc/cancel_ride';

    await Promise.all([
      protectedFetch(url, { method: 'POST', body: JSON.stringify({ p_ride_id: 'ride-1' }) }),
      protectedFetch(url, { method: 'POST', body: JSON.stringify({ p_ride_id: 'ride-2' }) }),
    ]);

    expect(baseFetch).toHaveBeenCalledTimes(2);
  });

  it('does not collapse normal read requests', async () => {
    const baseFetch = vi.fn(async () => new Response('[]', { status: 200 }));
    const protectedFetch = createSingleFlightFetch(baseFetch);
    const url = 'https://example.supabase.co/rest/v1/rides?select=*';

    await Promise.all([protectedFetch(url), protectedFetch(url)]);

    expect(baseFetch).toHaveBeenCalledTimes(2);
  });

  it('allows a new critical request after the previous one finishes', async () => {
    const baseFetch = vi.fn(async () => jsonResponse());
    const protectedFetch = createSingleFlightFetch(baseFetch);
    const url = 'https://example.supabase.co/rest/v1/rpc/complete_ride';
    const init = { method: 'POST', body: JSON.stringify({ p_ride_id: 'ride-1' }) };

    await protectedFetch(url, init);
    await protectedFetch(url, init);

    expect(baseFetch).toHaveBeenCalledTimes(2);
  });

  it('cleans rejected operations without creating an unhandled cleanup rejection', async () => {
    const baseFetch = vi
      .fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(jsonResponse({ success: true }));
    const protectedFetch = createSingleFlightFetch(baseFetch);
    const url = 'https://example.supabase.co/rest/v1/rpc/start_ride';
    const init = { method: 'POST', body: JSON.stringify({ p_ride_id: 'ride-1' }) };

    await expect(protectedFetch(url, init)).rejects.toThrow('network down');
    await expect(protectedFetch(url, init)).resolves.toBeInstanceOf(Response);
    expect(baseFetch).toHaveBeenCalledTimes(2);
  });
});
