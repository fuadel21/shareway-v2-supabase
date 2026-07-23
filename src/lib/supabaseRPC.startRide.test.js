import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpcMock = vi.fn();

vi.mock('./supabase', () => ({
    supabase: {
        rpc: rpcMock,
        functions: { invoke: vi.fn() },
        from: vi.fn(),
    },
}));

import { startRide } from './supabaseRPC';

const rpcResult = (data = null, error = null) => Promise.resolve({ data, error });

describe('startRide boarding guard', () => {
    beforeEach(() => {
        rpcMock.mockReset();
    });

    it('does not call start_ride while passengers remain unresolved', async () => {
        rpcMock.mockImplementation((name) => {
            if (name === 'get_ride_start_readiness') {
                return rpcResult({ ready: false, unresolved_count: 2 });
            }
            return rpcResult({ success: true });
        });

        const result = await startRide('ride-1');

        expect(result.success).toBe(false);
        expect(result.error).toContain('2 pasajero');
        expect(rpcMock).toHaveBeenCalledTimes(1);
        expect(rpcMock).not.toHaveBeenCalledWith('start_ride', expect.anything());
    });

    it('starts only after the readiness check passes', async () => {
        rpcMock
            .mockImplementationOnce(() => rpcResult({ ready: true, unresolved_count: 0 }))
            .mockImplementationOnce(() => rpcResult({ success: true }));

        const result = await startRide('ride-2');

        expect(result.success).toBe(true);
        expect(rpcMock).toHaveBeenNthCalledWith(1, 'get_ride_start_readiness', { p_ride_id: 'ride-2' });
        expect(rpcMock).toHaveBeenNthCalledWith(2, 'start_ride', { p_ride_id: 'ride-2', p_driver_id: null });
    });

    it('fails closed when readiness cannot be checked', async () => {
        rpcMock.mockImplementation(() => rpcResult(null, { message: 'network unavailable' }));

        const result = await startRide('ride-3');

        expect(result.success).toBe(false);
        expect(result.error).toContain('network unavailable');
        expect(rpcMock).toHaveBeenCalledTimes(1);
    });
});
