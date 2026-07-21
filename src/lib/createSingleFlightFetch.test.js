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

describe('createSingleFlightFetch', () => {
  it('collapses two identical critical RPC calls into one network request', async () => {
    const pending = deferred();
    const baseFetch = vi.fn(() => pending.promise);
    const protectedFetch = createSingleFlightFetch(baseFetch);
    const url = 'https://example.supabase.co/rest/v1/rpc/start_ride';
    const init = { method: 'POST', body: JSON.stringify({ p_ride_id: 'ride-1' }) };

    const first = protectedFetch(url, init);
    const second = protectedFetch(url, init);

    expect(baseFetch).toHaveBeenCalledTimes(1);

    pending.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }));
    const [firstResponse, secondResponse] = await Promise.all([first, second]);

    expect(firstResponse).not.toBe(secondResponse);
    await expect(firstResponse.json()).resolves.toEqual({ success: true });
    await expect(secondResponse.json()).resolves.toEqual({ success: true });
  });

  it('does not collapse different rides', async () => {
    const baseFetch = vi.fn(async () => new Response('{}', { status: 200 }));
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
    const baseFetch = vi.fn(async () => new Response('{}', { status: 200 }));
    const protectedFetch = createSingleFlightFetch(baseFetch);
    const url = 'https://example.supabase.co/rest/v1/rpc/complete_ride';
    const init = { method: 'POST', body: JSON.stringify({ p_ride_id: 'ride-1' }) };

    await protectedFetch(url, init);
    await protectedFetch(url, init);

    expect(baseFetch).toHaveBeenCalledTimes(2);
  });
});
